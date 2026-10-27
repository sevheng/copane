/**
 * Tells you when the AI finishes or waits for your answer, so you can look away while it works.
 *
 * `AgentWatch` turns the CLI's output into two events: "finished" (a stretch of work followed by
 * quiet) and "waiting" (the output stopped on what looks like an approval prompt). It knows
 * nothing about any one CLI beyond a few prompt patterns, so it works for claude, codex and others.
 */
import { isWsl } from "../app/clipboard"

export type Attention = "finished" | "waiting"
/** What a stretch of output ended as: work done, a question, or just a short burst (an answer, an echo). */
export type StretchEnd = Attention | "idle"

/** Quiet this long after output means the CLI stopped. */
export const QUIET_MS = 1500
/** Output must have flowed this long to count as work (not a keystroke echo or a redraw). */
export const MIN_WORK_MS = 2000

/** Screen text that means the CLI is asking you something (approval, a choice). */
const QUESTION = [
  /do you want to (proceed|make this edit|create|run|allow|continue)/i,
  /\b(allow|approve|run) (this )?(command|tool|edit|action)\??/i,
  /❯\s*1\.\s*yes/i,
  /\(y\/n\)|\[y\/n\]/i,
  /waiting for (your )?(approval|confirmation|input)/i,
  /trust this folder/i,
]

/** Plain text from terminal output: escape sequences dropped, whitespace collapsed. */
export function plain(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][0-9A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
}

export function looksLikeQuestion(text: string): boolean {
  return QUESTION.some((re) => re.test(text))
}

export class AgentWatch {
  private start = 0
  private last = 0
  /** The end of the raw output (escape codes and all); cleaned up only when a stretch ends. */
  private tail = ""
  private decoder = new TextDecoder()
  /** Set once a stretch of output has been reported, so one stretch gives one alert. */
  private reported = true

  constructor(private emit: (what: StretchEnd) => void) {}

  /** The CLI printed something. */
  output(data: Uint8Array | string, now = Date.now()): void {
    // After a quiet spell, this is a new stretch of output.
    if (now - this.last >= QUIET_MS) this.start = now
    this.reported = false
    this.last = now
    const text = typeof data === "string" ? data : this.decoder.decode(data, { stream: true })
    // Only the end of the screen matters (a prompt sits there). Output comes in hundreds of
    // chunks a second while an agent works: keep the raw tail here, clean it once in tick().
    this.tail = (this.tail + text).slice(-8000)
  }

  /** Call periodically: reports the end of a stretch of output once it has gone quiet. */
  tick(now = Date.now()): void {
    if (this.reported || now - this.last < QUIET_MS) return
    this.reported = true
    // The prompt is at the end of the screen: look only at the last output.
    const question = looksLikeQuestion(plain(this.tail).slice(-600))
    if (question) this.emit("waiting")
    else if (this.last - this.start >= MIN_WORK_MS) this.emit("finished")
    else this.emit("idle")
  }

  /** Whether a stretch of output is waiting to be reported (tick only matters then). */
  get pending(): boolean {
    return !this.reported
  }

  /** You answered or typed in the pane: whatever was on screen is no longer news. */
  reset(): void {
    this.reported = true
    this.tail = ""
  }
}

// ---- system notifications ----

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** UTF-16LE base64, the encoding PowerShell's -EncodedCommand expects. */
function utf16Base64(text: string): string {
  const units = new Uint16Array(text.length)
  for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i)
  return new Uint8Array(units.buffer).toBase64()
}

/** The command that shows a desktop notification on this system, or null to use the terminal's (OSC 9). */
export function notifyCommand(
  title: string,
  body: string,
  platform: "wsl" | "mac" | "linux",
  has: (cmd: string) => boolean,
): string[] | null {
  if (platform === "wsl" && has("powershell.exe")) {
    // A Windows toast through WinRT: no module to install. The app id is PowerShell's, so Windows shows it.
    const script = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
      "$x = $t.GetElementsByTagName('text')",
      `$x.Item(0).AppendChild($t.CreateTextNode(${psQuote(title)})) | Out-Null`,
      `$x.Item(1).AppendChild($t.CreateTextNode(${psQuote(body)})) | Out-Null`,
      "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($t))",
    ].join("; ")
    return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", utf16Base64(script)]
  }
  if (platform === "mac" && has("osascript")) {
    const q = (s: string) => JSON.stringify(s)
    return ["osascript", "-e", `display notification ${q(body)} with title ${q(title)}`]
  }
  if (platform === "linux" && has("notify-send")) return ["notify-send", title, body]
  return null
}

/** The bell, written straight to the terminal: BEL moves no cursor, so it doesn't disturb the screen. */
export function ringBell(write: (s: string) => void = (s) => process.stdout.write(s)): void {
  write("\x07")
}

/**
 * A system notification. Without a system tool, the terminal's own (iTerm2, kitty, WezTerm, Ghostty...):
 * `terminal` is the renderer's `triggerNotification`, which picks the sequence and passes it through tmux.
 */
export function desktopNotify(title: string, body: string, terminal: (message: string, title: string) => boolean): void {
  const platform = isWsl() ? "wsl" : process.platform === "darwin" ? "mac" : "linux"
  const cmd = notifyCommand(title, body, platform, (c) => Bun.which(c) !== null)
  if (!cmd) {
    terminal(body, title)
    return
  }
  try {
    Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  } catch {
    // no notifications on this system; the notice and bell still happened
  }
}
