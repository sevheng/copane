import { basename, dirname, join, relative } from "node:path"
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard, useRenderer } from "@opentui/react"
import { EmbeddedTerminalRenderable, type BoxRenderable } from "@opentui/core"
import { useBufferSelector, useUi, useWorkspace, type AiHandle, type Workspace } from "../app/workspace"
import type { MenuItem } from "../app/state"
import { onShutdown } from "../app/shutdown"
import { Store } from "../app/store"
import { ui as colors } from "../config/theme"
import { HoverBox } from "../app/Modal"
import { cursorSequence, resetsCursorStyle } from "./cursorStyle"
import { runCommand } from "../keymap/commands"
import { AgentProcess, type AgentStatus } from "./AgentProcess"
import { GitRepo } from "../git/repo"
import { AgentWatch, desktopNotify, plain, ringBell, type Attention } from "./alerts"
import { lastError, OutputLines, servicesFor, type Service, type ServiceError } from "./services"
import { linkAt, openLink } from "./terminalLinks"
import { claudeArgs, newClaudeSession } from "./claudeSession"
import type { RestoreState, RestoredTab } from "../app/update"

export interface AgentChoice {
  name: string
  command: string
  args: string[]
}

export interface AiConfig {
  command: string
  args: string[]
  maxScrollbackBytes: number
  notify?: "bell" | "desktop" | "off"
  /** More CLIs offered for new tabs, besides `command`. */
  agents?: AgentChoice[]
  /** Dev servers to offer (`services` in the config); detected from the project when empty. */
  services?: { name: string; command: string; cwd?: string }[]
}

/** One AI pane tab: a CLI running in a folder (the project, or a git worktree of it). */
export interface Session {
  id: number
  name: string
  command: string
  args: string[]
  cwd: string
  /** The worktree's branch, when the agent runs in its own git worktree. */
  branch: string | null
  /**
   * The worktree's top folder, when it differs from `cwd`: the editor was opened in a subfolder
   * of the repo, and the agent starts in the same subfolder of its worktree.
   */
  worktree?: string
  /** A terminal tab (your shell, not an agent), and the command it was opened to run (a dev server). */
  terminal?: { run?: string }
  /** A claude tab's conversation id: it starts (and after a restart of copane resumes) that one. */
  claudeSession?: string
}

/** The top folder of a worktree session's checkout (what git commands run in). */
export const worktreeOf = (s: Pick<Session, "cwd" | "worktree">): string => s.worktree ?? s.cwd

interface SessionState {
  status: string
  /** When the current stretch of output began (the header starts its spinner then). */
  busySince: number
  attention: Attention | null
  /** Files a worktree agent changed since its branch split off (shown on its tab). */
  changes?: number
  /** A terminal's current error (✗ on its tab), until a rebuild, a restart or your next command. */
  error?: ServiceError | null
}

/**
 * When each tab's CLI last printed something; "working" while that was recent. Kept out of the
 * store: output arrives hundreds of times a second, and only the start of a stretch needs a render.
 */
const lastOutput = new Map<number, number>()
const isBusy = (id: number) => Date.now() - (lastOutput.get(id) ?? 0) < BUSY_MS

const RIGHT = 2
const DIM = "\x1b[2m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"
const LINE_FEED = new Uint8Array([10])
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const BUSY_MS = 800

function describeStatus(cmd: string, s: AgentStatus): string {
  switch (s.kind) {
    case "idle":
      return `${cmd}: starting`
    case "running":
      return `${cmd} ●`
    case "exited":
      return `${cmd}: exited`
    case "error":
      return `${cmd}: error`
  }
}

/** The tabs, which is visible, and each one's state (the header and status bar read it). */
const tabs = new Store<{ sessions: Session[]; active: number; state: Record<number, SessionState> }>({
  sessions: [],
  active: 0,
  state: {},
})
const setState = (id: number, patch: Partial<SessionState>) => {
  const t = tabs.get()
  const prev = t.state[id] ?? { status: "", busySince: 0, attention: null }
  tabs.set({ state: { ...t.state, [id]: { ...prev, ...patch } } })
}
/** Each tab's terminal, for copying its selection. */
const terminals = new Map<number, EmbeddedTerminalRenderable>()
/** Each tab's handle (send text to its CLI); ws.ai forwards to the visible one. */
const handles = new Map<number, AiHandle & { proc: () => AgentProcess | null }>()

/** Tests: no tabs, terminals or handles left from another test (ids restart at 1). */
/** Saved tabs that can open again: those whose folder is gone (a removed worktree) are left out. */
export async function restorableTabs(saved: NonNullable<RestoreState["ai"]>): Promise<RestoreState["ai"]> {
  const shown = saved.tabs[saved.active]
  const kept: RestoredTab[] = []
  for (const t of saved.tabs)
    if (
      await Bun.file(t.cwd)
        .stat()
        .then(
          (s) => s.isDirectory(),
          () => false,
        )
    )
      kept.push(t)
  if (!kept.length) return undefined
  return { tabs: kept, active: Math.max(0, kept.indexOf(shown!)) }
}

/** The open tabs, to open again after a restart. */
export function snapshotAgentTabs(): RestoreState["ai"] {
  const { sessions, active } = tabs.get()
  if (!sessions.length) return undefined
  return {
    tabs: sessions.map(({ id: _id, ...tab }) => tab),
    active: Math.max(
      0,
      sessions.findIndex((s) => s.id === active),
    ),
  }
}

export function resetAgentTabs(): void {
  for (const h of handles.values()) h.kill()
  handles.clear()
  terminals.clear()
  lastOutput.clear()
  lastAgent = 0
  tabs.set({ sessions: [], active: 0, state: {} })
}

/**
 * The agent tab that "send to AI" actions type into: the visible tab, or when that is a terminal,
 * the agent tab last shown. Text meant for the AI must never land in a shell or a dev server.
 */
let lastAgent = 0
function agentTab(): number {
  const { sessions, active } = tabs.get()
  const isAgent = (id: number) => sessions.some((s) => s.id === id && !s.terminal)
  if (isAgent(active)) return (lastAgent = active)
  return isAgent(lastAgent) ? lastAgent : (sessions.find((s) => !s.terminal)?.id ?? active)
}

/** The terminal errors now shown: the visible tab's first, then the newest tab's. */
export function terminalErrors(): { session: Session; error: ServiceError }[] {
  const { sessions, state, active } = tabs.get()
  return sessions
    .filter((s) => s.terminal && state[s.id]?.error)
    .map((s) => ({ session: s, error: state[s.id]!.error! }))
    .reverse()
    .sort((a, b) => Number(b.session.id === active) - Number(a.session.id === active))
}

/** The shell terminal tabs run. */
const shell = () => Bun.env.SHELL || "/bin/sh"

/** The status bar's AI segment: the visible tab's status. */
export const aiStatusSource = {
  subscribe: tabs.subscribe,
  get: () => {
    const t = tabs.get()
    return t.state[t.active]?.status ?? ""
  },
}

function tabLabel(s: Session): string {
  // copane/claude-2 → claude-2: every agent worktree branch has that prefix.
  return s.branch ? `${s.name} ⎇ ${s.branch.replace(/^copane\//, "")}` : s.name
}

/** The header: a tab per agent (with its state), and + to start another. */
function AiHeader({ focused, onNew, onClose }: { focused: boolean; onNew: () => void; onClose: (id: number) => void }) {
  const ws = useWorkspace()
  const ui = useUi()
  // The editor is hidden (⤡ restores); shown with Ctrl+E, ⤢ hides it again.
  const files = useBufferSelector((b) => b.list().length)
  const aiFull = !!ui.aiMaximized && !(ui.aiMaximized.editor && files)
  const t = useSyncExternalStore(tabs.subscribe, tabs.get)
  const [frame, setFrame] = useState(0)
  const busy = isBusy
  const anyBusy = t.sessions.some((s) => !s.terminal && busy(s.id))
  // Tick only while output is flowing; idle panes cost nothing.
  useEffect(() => {
    if (!anyBusy) return
    const timer = setInterval(() => setFrame((f) => f + 1), 120)
    return () => clearInterval(timer)
  }, [anyBusy])
  const one = t.sessions.length === 1
  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      backgroundColor={colors.headerBg}
      paddingLeft={1}
      paddingRight={1}
      gap={1}
      overflow="hidden"
    >
      {/* The tabs take what is left and clip, so + and the buttons on the right always show. */}
      <box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} gap={1} overflow="hidden">
        {t.sessions.map((s) => {
          const st = t.state[s.id]
          const active = s.id === t.active
          // A terminal shows its health, not activity: dev servers print all the time.
          const mark = s.terminal
            ? st?.error
              ? "✗"
              : st?.status.endsWith("●")
                ? "●"
                : "○"
            : busy(s.id)
              ? SPINNER[frame % SPINNER.length]
              : st?.attention === "waiting"
                ? "⚠"
                : st?.attention === "finished"
                  ? "✓"
                  : st?.status.endsWith("●")
                    ? "●"
                    : "○"
          const markColor = s.terminal
            ? st?.error
              ? colors.error
              : st?.status.endsWith("●")
                ? colors.ok
                : colors.headerFg
            : busy(s.id) || st?.attention === "waiting"
              ? colors.warn
              : st?.attention
                ? colors.ok
                : colors.headerFg
          const label = tabLabel(s).toUpperCase()
          return (
            <box key={s.id} flexDirection="row" flexShrink={0} backgroundColor={active && !one ? colors.segmentBg : undefined}>
              {/* Click switches to the tab; a middle-click closes it, as editor tabs do. */}
              <HoverBox
                onPress={(button) => (button === 1 && !one ? onClose(s.id) : tabs.set({ active: s.id }))}
                paddingX={one ? 0 : 1}
              >
                <text selectable={false} fg={active && focused ? colors.accent : colors.headerFg}>
                  {active && focused ? <strong>{label}</strong> : label}
                </text>
                <text selectable={false} fg={markColor}>
                  {" " + mark}
                </text>
              </HoverBox>
              {/* A worktree agent's changed files: a click reviews and merges them. */}
              {s.branch && st?.changes ? (
                <HoverBox onPress={() => ws.ui.set({ modal: { kind: "mergeAgent", sessionId: s.id } })} paddingX={0}>
                  <text selectable={false} fg={colors.headerFg}>
                    {`· ${st.changes} `}
                  </text>
                </HoverBox>
              ) : null}
              {/* A dev server's tab: restart it (a fresh shell running its command again). */}
              {active && s.terminal?.run ? (
                <HoverBox onPress={() => handles.get(s.id)?.restart()} paddingX={0}>
                  <text selectable={false} fg={colors.headerFg}>
                    {"↻ "}
                  </text>
                </HoverBox>
              ) : null}
              {one ? null : (
                <HoverBox onPress={() => onClose(s.id)} paddingX={0}>
                  <text selectable={false} fg={colors.dim}>
                    {"× "}
                  </text>
                </HoverBox>
              )}
            </box>
          )
        })}
      </box>
      {/* The visible terminal's error, one click from the AI (Ctrl+K E). */}
      {t.sessions.some((s) => s.id === t.active && s.terminal) && t.state[t.active]?.error ? (
        <HoverBox onPress={() => void runCommand(ws, "ai.fixTerminalError")}>
          <text selectable={false} fg={colors.error}>
            ✗ Fix with AI
          </text>
        </HoverBox>
      ) : null}
      {/* New agent, terminal or dev server. */}
      <HoverBox onPress={() => onNew()}>
        <text selectable={false} fg={colors.headerFg}>
          {one ? "+ new" : "+"}
        </text>
      </HoverBox>
      {/* Maximize AI (Ctrl+Alt+X): hides the editor until you show it; again restores. */}
      <HoverBox onPress={() => void runCommand(ws, "view.maximizeAi")}>
        <text selectable={false} fg={aiFull ? colors.accent : colors.headerFg}>
          {aiFull ? "⤡" : "⤢"}
        </text>
      </HoverBox>
    </box>
  )
}

/** One tab: its terminal and CLI process. Hidden tabs keep running. Memoized: it drives its terminal itself. */
const AgentSession = memo(function AgentSession({
  session,
  active,
  focused,
  config,
}: {
  session: Session
  active: boolean
  focused: boolean
  config: AiConfig
}) {
  const ws = useWorkspace()
  const renderer = useRenderer()
  const boxRef = useRef<BoxRenderable | null>(null)
  const termRef = useRef<EmbeddedTerminalRenderable | null>(null)
  const procRef = useRef<AgentProcess | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const id = session.id
    const name = session.name
    const term = new EmbeddedTerminalRenderable(renderer, {
      id: `ai-terminal-${id}`,
      // Width/height must be relative, otherwise they default to a fixed 80x24 grid.
      width: "100%",
      height: "100%",
      flexGrow: 1,
      maxScrollback: config.maxScrollbackBytes,
      transparentBackground: true,
      // Runs after the emulator forwards the click. When the CLI has mouse reporting on
      // (claude does), the emulator stops propagation, so the wrapper box never sees it.
      onMouseDown: (e) => {
        // Ctrl+click (or Alt+click) on a file:line or a URL opens it, as in VS Code's terminal.
        if (e.button === 0 && (e.modifiers.ctrl || e.modifiers.alt)) {
          const link = linkAt(term.screen().lines[e.y - term.y] ?? "", e.x - term.x, session.cwd)
          if (link) {
            e.preventDefault()
            e.stopPropagation()
            return void openLink(ws, link)
          }
        }
        if (e.button === 0 && ws.ui.get().focus !== "ai") ws.ui.set({ focus: "ai" })
      },
    })
    // Legacy terminals send Ctrl+J as a bare line feed, a key the emulator's encoder has no code
    // for: pass the byte on (Claude's new line, as when it runs on its own).
    const encodeKey = term.encodeKey.bind(term)
    term.encodeKey = (key) =>
      key.name === "linefeed" && key.eventType !== "release" && !key.ctrl && !key.meta && !key.option ? LINE_FEED : encodeKey(key)
    // The cursor shape of editor.cursorStyle (a thin line by default), until the program asks for another.
    const cursor = cursorSequence(ws.config.editor.cursorStyle)
    term.write(cursor)
    const run = session.terminal?.run ?? null
    // A terminal's recent output as text, scanned for errors once it settles.
    const output = session.terminal ? new OutputLines() : null
    let errorTimer: ReturnType<typeof setTimeout> | null = null
    const scanErrors = () => {
      errorTimer = null
      if (disposed || !output) return
      const error = lastError(output.lines(), session.cwd)
      const before = tabs.get().state[id]?.error ?? null
      if ((error?.text ?? null) === (before?.text ?? null)) return
      setState(id, { error })
      // Say so once per new error, unless you're looking at it.
      const watching = tabs.get().active === id && ws.ui.get().focus === "ai" && ws.ui.get().aiVisible
      if (error && !watching)
        ws.notify(`✗ ${name}: ${error.text.split("\n")[0]!.trim().slice(0, 120)}  (Ctrl+K E sends it to the AI)`, "error")
    }
    // A CLI that opens with a question (claude's "trust this folder?") waits for an answer the
    // user may not notice while focus is in the tree or editor: bring them to it, once.
    const startedAt = Date.now()
    let asked = false
    let tail = ""
    let lastScan = 0
    const decoder = new TextDecoder()
    const watchForQuestion = (data: Uint8Array) => {
      if (asked) return
      const now = Date.now()
      if (now - startedAt > 30_000) return
      // Output arrives in chunks with escape sequences between words: match on recent plain text.
      // A CLI can print hundreds of chunks a second: collect raw, clean and look a few times a second.
      tail = (tail + decoder.decode(data, { stream: true })).slice(-8000)
      if (now - lastScan < 250) {
        // Look again once the burst settles: the question may be the last thing printed.
        scanTimer ??= setTimeout(() => {
          scanTimer = null
          scanForQuestion()
        }, 250)
        return
      }
      scanForQuestion()
    }
    let scanTimer: ReturnType<typeof setTimeout> | null = null
    const scanForQuestion = () => {
      lastScan = Date.now()
      if (asked || disposed || !/trust\s+this\s+folder|do\s+you\s+trust/i.test(plain(tail))) return
      asked = true
      const pullFocus = () => {
        if (ws.ui.get().focus === "ai") return
        tabs.set({ active: id })
        ws.ui.set({ focus: "ai", aiVisible: true })
        term.focus()
        ws.notify(`${name} is asking a question in the AI pane`)
      }
      if (!ws.ui.get().modal) return pullFocus()
      // A dialog is open: once it closes (the question can't be answered meanwhile).
      offModalWait = ws.ui.subscribe(() => {
        if (ws.ui.get().modal || disposed) return
        offModalWait?.()
        offModalWait = null
        pullFocus()
      })
    }
    let offModalWait: (() => void) | null = null
    // Tell the user when the AI finishes or waits, unless they're watching this tab.
    let windowFocused = true
    const onFocus = () => (windowFocused = true)
    const onBlur = () => (windowFocused = false)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    // Turns (what the AI changed per prompt) follow agents working in the project itself; one
    // in a worktree edits another folder.
    const turns = session.cwd === ws.root ? ws.turns : null
    let prompt = ""
    let turnStart = 0
    const submitted = () => {
      turnStart = Date.now()
      void turns?.begin(prompt)
      prompt = ""
    }
    /** Follow what goes into the prompt: typed text, pastes, Backspace; Enter submits. */
    const track = (text: string) => {
      for (const part of text.replace(/\x1b\[20[01]~/g, "").split(/(\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b.)/)) {
        if (part.startsWith("\x1b")) continue
        for (const ch of part) {
          if (ch === "\r") submitted()
          else if (ch === "\x7f" || ch === "\b") prompt = prompt.slice(0, -1)
          else if (ch === "\x15")
            prompt = "" // Ctrl+U clears the line
          else if (ch >= " " || ch === "\n") prompt = (prompt + ch).slice(-500)
        }
      }
    }
    const watch = new AgentWatch((what) => {
      // A turn ends when the AI goes quiet (not while it waits on a question). The first moments
      // after Enter don't count: the CLI may not have started answering yet.
      if (what !== "waiting" && Date.now() - turnStart > 3000) void turns?.end()
      // A worktree agent went quiet: recount its changes for the tab.
      if (session.branch) void recount(ws, id)
      if (what === "idle") return
      const ui = ws.ui.get()
      const how = config.notify ?? "bell"
      const watching = tabs.get().active === id && ui.focus === "ai" && ui.aiVisible && !ui.modal && windowFocused
      if (how === "off" || watching) return
      const text = what === "waiting" ? `${name} is waiting for your answer` : `${name} finished`
      setState(id, { attention: what })
      ws.ui.set({ aiAttention: what })
      // Changes waiting for review: say so, with the key that starts it from anywhere.
      const toReview = what === "finished" ? (ws.review?.files().length ?? 0) : 0
      const hint = toReview ? ` · ${toReview} file${toReview === 1 ? "" : "s"} to review (Ctrl+Alt+V)` : " (Ctrl+J to look)"
      ws.notify(text + hint, what === "waiting" ? "warn" : "info")
      ringBell()
      if (how === "desktop") desktopNotify("copane", text, (m, t) => renderer.triggerNotification(m, t))
    })
    // The watch only needs ticks while a stretch of output awaits its verdict.
    let ticker: ReturnType<typeof setInterval> | null = null
    let disposed = false
    const tick = () => {
      watch.tick()
      if (!watch.pending && ticker) {
        clearInterval(ticker)
        ticker = null
      }
    }
    const ensureTicker = () => {
      if (ticker) return
      ticker = setInterval(tick, 500)
      ticker.unref?.()
    }
    const proc = new AgentProcess({
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      onOutput: (data) => {
        if (disposed) return // the tab closed; the CLI is being stopped
        term.write(data)
        if (resetsCursorStyle(data)) term.write(cursor)
        if (output) {
          output.push(data)
          errorTimer ??= setTimeout(scanErrors, 300)
          return
        }
        const now = Date.now()
        const quietBefore = !isBusy(id)
        lastOutput.set(id, now)
        // Only the start of a stretch re-renders (to start the spinner); its ticks do the rest.
        if (quietBefore) setState(id, { busySince: now })
        watchForQuestion(data)
        watch.output(data)
        ensureTicker()
      },
      onStatus: (s) => {
        if (disposed) return
        // The command's name, not its path: the status bar has little room.
        setState(id, { status: describeStatus(name, s) })
        if (s.kind === "exited" && output) {
          // `exit` (or Ctrl+D) closes the tab, as in VS Code.
          if (s.code === 0) return void setTimeout(() => closeTab(id), 0)
          // A shell that dies is an error even when it printed none we know: show its last lines.
          if (s.code)
            setState(id, {
              error: lastError(output.lines(), session.cwd) ?? { text: output.lines().slice(-15).join("\n"), location: null },
            })
          term.write(
            `\r\n${YELLOW}[${name} stopped${s.code !== null ? ` with code ${s.code}` : ""}. Press Enter to start it again.]${RESET}\r\n`,
          )
        } else if (s.kind === "exited") {
          term.write(
            `\r\n${YELLOW}[${name} exited${s.code !== null ? ` with code ${s.code}` : ""}. Press Enter to restart.]${RESET}\r\n`,
          )
        } else if (s.kind === "error") {
          term.write(
            `\r\n${YELLOW}${s.message}.${RESET}\r\n${DIM}Install it, or set ai.command (F1 › Open settings).\r\nPress Enter to retry.${RESET}\r\n`,
          )
        }
      },
    })
    term.onData = (data) => {
      if (output) {
        // Your next command starts a new round: the last one's error is over.
        if (data.includes(13)) {
          output.clear()
          if (tabs.get().state[id]?.error) setState(id, { error: null })
        }
        return proc.write(data)
      }
      // You're answering or typing: what's on screen isn't news any more.
      watch.reset()
      track(new TextDecoder().decode(data))
      proc.write(data)
    }
    term.onTerminalResize = (cols, rows) => proc.resize(cols, rows)
    box.add(term)
    termRef.current = term
    procRef.current = proc
    terminals.set(id, term)

    // The emulator may resize before the child exists (that resize is dropped),
    // so always push the current layout size right after starting.
    const startProc = async () => {
      // A claude tab goes back into its conversation once Claude has saved it.
      const args = session.claudeSession ? await claudeArgs(session.args, session.claudeSession) : session.args
      if (disposed) return
      const cols = Math.max(20, term.width)
      const rows = Math.max(5, term.height)
      proc.start(cols, rows, args)
      proc.resize(cols, rows)
      // A run target: type its command into the fresh shell (it waits in the input until the shell reads it).
      if (run) proc.write(`${run}\r`)
    }
    // Start after the first layout so the PTY gets the real size.
    const startTimer = setTimeout(() => void startProc(), 50)

    handles.set(id, {
      paste(text) {
        const bytes = term.encodePaste(new TextEncoder().encode(text))
        if (bytes.length) proc.write(bytes)
        track(text.replace(/\r/g, "\n"))
      },
      type(text) {
        const line = text.replace(/[\r\n]+/g, " ")
        track(line)
        proc.write(line)
      },
      submit() {
        submitted()
        proc.write("\r")
      },
      focus() {
        term.focus()
      },
      restart() {
        const again = () => {
          term.write("\x1bc") // reset the emulator screen
          output?.clear()
          setState(id, { error: null })
          void startProc()
        }
        // A terminal restarts while running (a fresh shell, its command again); an agent only once it has exited.
        if (proc.status.kind !== "running") again()
        else if (output) void proc.kill().then(() => !disposed && again())
      },
      kill() {
        void proc.kill()
      },
      proc: () => procRef.current,
    })
    const offShutdown = onShutdown(() => proc.kill(500))

    return () => {
      // Output or an exit after this must not re-arm the ticker or alert about a closed tab.
      disposed = true
      clearTimeout(startTimer)
      if (scanTimer) clearTimeout(scanTimer)
      if (errorTimer) clearTimeout(errorTimer)
      if (ticker) clearInterval(ticker)
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
      offShutdown()
      offModalWait?.()
      handles.delete(id)
      lastOutput.delete(id)
      terminals.delete(id)
      void proc.kill(500)
      term.destroy()
      termRef.current = null
      procRef.current = null
    }
  }, [renderer, ws, session, config.maxScrollbackBytes, config.notify])

  // Mirror app focus onto the emulator so keys flow to the CLI only when its tab is shown and focused.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active && focused) term.focus()
    else term.blur()
    // Looking at the tab is seeing the news.
    if (active && focused) {
      if (tabs.get().state[session.id]?.attention) setState(session.id, { attention: null })
      if (ws.ui.get().aiAttention) ws.ui.set({ aiAttention: null })
    }
  }, [active, focused, ws, session.id])

  return <box ref={boxRef} flexGrow={1} flexDirection="column" visible={active} />
})

/**
 * Where a new worktree for `name` goes: beside the repo, e.g. ../app-codex-2, and the folder in it
 * matching `root` (the same as `path` unless the editor was opened in a subfolder of the repo `top`).
 */
export function worktreeFor(root: string, name: string, n: number, top = root): { path: string; branch: string; cwd: string } {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "agent"
  const path = join(dirname(top), `${basename(top)}-${slug}-${n}`)
  return { path, branch: `copane/${slug}-${n}`, cwd: join(path, relative(top, root)) }
}

/**
 * The AI pane: one tab per agent CLI. ws.ai always points at the visible tab.
 * `restored`: the tabs open before a restart, opened instead of one fresh tab.
 */
export function TerminalPane({ config, restored }: { config: AiConfig; restored?: RestoreState["ai"] }) {
  const ws = useWorkspace()
  const ui = useUi()
  const t = useSyncExternalStore(tabs.subscribe, tabs.get)
  const focused = ui.focus === "ai" && !ui.modal
  const nextId = useRef(2)
  const saved = useRef(restored)

  // The first tab: ai.command in the project, or the tabs open before a restart.
  useEffect(() => {
    const restore = saved.current
    saved.current = undefined
    if (restore) {
      tabs.set({ sessions: restore.tabs.map((t, i) => ({ ...t, id: i + 1 })), active: restore.active + 1, state: {} })
      nextId.current = restore.tabs.length + 1
      return
    }
    const name = basename(config.command)
    const claudeSession = newClaudeSession(config.command, config.args)
    tabs.set({
      sessions: [
        {
          id: 1,
          name,
          command: config.command,
          args: config.args,
          cwd: ws.root,
          branch: null,
          ...(claudeSession ? { claudeSession } : {}),
        },
      ],
      active: 1,
      state: {},
    })
    nextId.current = 2
  }, [ws, config.command, config.args])

  useEffect(() => {
    // Text for the AI goes to an agent tab, never into a dev server's.
    const agent = () => handles.get(agentTab())
    ws.ai = {
      paste: (text) => agent()?.paste(text),
      type: (text) => agent()?.type(text),
      submit: () => agent()?.submit(),
      focus: () => {
        const id = agentTab()
        if (tabs.get().active !== id) tabs.set({ active: id })
        handles.get(id)?.focus()
      },
      restart: () => handles.get(tabs.get().active)?.restart(),
      kill: () => {
        for (const h of handles.values()) h.kill()
      },
    }
    ws.agents = {
      openMenu: (x, y) => void openNewMenu(ws, config, x, y, (s) => addSession(s)),
      cycle(dir) {
        const { sessions, active } = tabs.get()
        if (sessions.length < 2) return
        const i = sessions.findIndex((s) => s.id === active)
        tabs.set({ active: sessions[(i + dir + sessions.length) % sessions.length]!.id })
        ws.ui.set({ focus: "ai", aiVisible: true })
      },
      closeActive: () => closeSession(ws, tabs.get().active),
      session: (id) => tabs.get().sessions.find((s) => s.id === id),
      activeId: () => tabs.get().active,
      close: (id) => {
        // The last tab can't go: start a fresh one in the project first.
        if (tabs.get().sessions.length < 2)
          addSession({ name: basename(config.command), command: config.command, args: config.args, cwd: ws.root, branch: null })
        closeTab(id)
      },
      stop: async (id) => {
        await handles.get(id)?.proc()?.kill(1500)
      },
      recount: (id) => void recount(ws, id),
      openRun: (x, y) => void openNewMenu(ws, config, x, y, (s) => addSession(s), true),
      newTerminal: () => addSession(terminalSession(ws.root)),
      snapshot: snapshotAgentTabs,
      sendTerminalError: () => sendTerminalError(ws),
    }
    return () => {
      ws.ai = null
      ws.agents = null
    }
  }, [ws, config])

  const addSession = (s: Omit<Session, "id">) => {
    const id = nextId.current++
    // A second tab of the same CLI gets a number: "claude 2".
    const same = tabs.get().sessions.filter((o) => o.name === s.name || o.name.startsWith(`${s.name} `)).length
    const name = same ? `${s.name} ${same + 1}` : s.name
    const claudeSession = s.claudeSession ?? newClaudeSession(s.command, s.args)
    tabs.set({ sessions: [...tabs.get().sessions, { ...s, name, id, ...(claudeSession ? { claudeSession } : {}) }], active: id })
    ws.ui.set({ focus: "ai", aiVisible: true })
  }

  // Enter restarts a dead process.
  useKeyboard((key) => {
    if (!focused || key.name !== "return") return
    const proc = handles.get(tabs.get().active)?.proc()
    if (proc && proc.status.kind !== "running") {
      key.preventDefault()
      key.stopPropagation()
      ws.ai?.restart()
    }
  })

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      onMouseDown={(e) => {
        // Right-click copies the selection, or pastes when there is none (VS Code's terminal on Windows).
        if (e.button === RIGHT) {
          e.stopPropagation()
          void copyOrPaste(ws, t.active)
          return
        }
        if (ws.ui.get().focus !== "ai") ws.ui.set({ focus: "ai" })
      }}
      // Ctrl+C belongs to the CLI, so mouse selections are copied on release instead.
      onMouseUp={() => {
        const text = terminalSelection(t.active)
        if (text) void ws.clipboard.copy(text).then(() => ws.notify(`Copied ${text.length} chars`))
      }}
    >
      <AiHeader focused={focused} onNew={() => ws.agents?.openMenu()} onClose={(id) => closeSession(ws, id)} />
      {t.sessions.map((s) => (
        <AgentSession key={s.id} session={s} active={s.id === t.active} focused={focused} config={config} />
      ))}
    </box>
  )
}

/** Right-click in a tab: copy its selection, else paste the clipboard into it (agent or terminal). */
async function copyOrPaste(ws: Workspace, id: number): Promise<void> {
  const selected = terminalSelection(id)
  if (selected) {
    await ws.clipboard.copy(selected)
    return ws.notify(`Copied ${selected.length} chars`)
  }
  const text = await ws.clipboard.paste()
  if (text) handles.get(id)?.paste(text)
  ws.ui.set({ focus: "ai" })
  handles.get(id)?.focus()
}

/** The selected text in a tab's terminal. */
function terminalSelection(id: number): string {
  const term = terminals.get(id)
  return term?.hasSelection() ? term.getSelectedText() : ""
}

/** Where a menu opens: at the pointer, or (from a key or a header button) under the AI pane's header. */
function menuAt(x: number | undefined, y: number | undefined): { x: number; y: number } {
  return {
    x: x !== undefined && x >= 0 ? x : Math.max(2, (process.stdout.columns || 80) - 52),
    y: y !== undefined && y >= 0 ? y : 1,
  }
}

/** A terminal tab: your shell in `cwd`, optionally typing a command into it (a dev server). */
function terminalSession(cwd: string, target?: Service): Omit<Session, "id"> {
  return {
    name: target?.name ?? basename(shell()),
    command: shell(),
    args: [],
    cwd: target?.cwd ?? cwd,
    branch: null,
    terminal: target ? { run: target.command } : {},
  }
}

/**
 * The + menu: each configured agent CLI (in the project or a new git worktree), a terminal, and
 * the project's dev servers to run (configured or detected; ● when running, which shows its tab).
 * `runOnly` lists just the dev servers.
 */
async function openNewMenu(
  ws: Workspace,
  config: AiConfig,
  x: number | undefined,
  y: number | undefined,
  add: (s: Omit<Session, "id">) => void,
  runOnly = false,
): Promise<void> {
  const choices: AgentChoice[] = [
    { name: basename(config.command), command: config.command, args: config.args },
    ...(config.agents ?? []),
  ]
  const repo = ws.git?.main.repo ?? null
  const count = (name: string) => tabs.get().sessions.filter((s) => s.name === name || s.name.startsWith(`${name} `)).length
  const inWorktree = async (c: AgentChoice) => {
    if (!repo) return
    let n = count(c.name) + 1
    let wt = worktreeFor(ws.root, c.name, n, repo.top)
    // Skip numbers still taken: a worktree folder, or a branch kept after its worktree was removed.
    while ((await Bun.file(join(wt.path, ".git")).exists()) || (await repo.branchExists(wt.branch)))
      wt = worktreeFor(ws.root, c.name, ++n, repo.top)
    ws.notify(`Creating worktree ${wt.path}…`)
    const err = await repo.addWorktree(wt.path, wt.branch)
    if (err) return ws.notify(`Could not create the worktree: ${err}`, "error")
    add({
      name: c.name,
      command: c.command,
      args: c.args,
      cwd: wt.cwd,
      branch: wt.branch,
      ...(wt.cwd !== wt.path ? { worktree: wt.path } : {}),
    })
    ws.notify(`${c.name} works in ${wt.path} on branch ${wt.branch}`)
  }
  let targets: Service[] = []
  try {
    targets = await servicesFor(ws.root, config.services ?? [])
  } catch {}
  // Agent worktrees left from before (their tab closed, or ce restarted): open one again.
  const open = new Set(
    tabs
      .get()
      .sessions.map((s) => s.branch)
      .filter(Boolean),
  )
  const leftover =
    runOnly || !repo ? [] : (await repo.worktrees()).filter((w) => w.branch?.startsWith("copane/") && !open.has(w.branch))
  const resumeItems: MenuItem[] = leftover.map((w) => {
    const branch = w.branch!
    // copane/claude-4 was made for the "claude" agent: start that CLI again (else the first one).
    const slug = branch.slice("copane/".length).replace(/-\d+$/, "")
    const c = choices.find((x) => x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === slug) ?? choices[0]!
    // Claude Code picks up its last conversation in that folder.
    const args = basename(c.command) === "claude" && !c.args.includes("--continue") ? [...c.args, "--continue"] : c.args
    const cwd = join(w.path, relative(repo!.top, ws.root))
    return {
      label: `Resume ${c.name} ⎇ ${branch}`,
      run: () => add({ name: c.name, command: c.command, args, cwd, branch, ...(cwd !== w.path ? { worktree: w.path } : {}) }),
    }
  })
  if (runOnly && !targets.length)
    return ws.notify(
      'No dev servers found: add a "dev" script to a package.json, or list them in the config ("ai": { "services": [...] })',
      "warn",
    )
  const tabOf = (t: Service) => tabs.get().sessions.find((o) => o.terminal?.run === t.command && o.cwd === t.cwd)
  const runItems: MenuItem[] = targets.map((t) => ({
    label: `${tabOf(t) ? "●" : "▶"} Run ${t.name}`,
    hint: t.command,
    run: () => {
      const open = tabOf(t)
      if (!open) return add(terminalSession(ws.root, t))
      tabs.set({ active: open.id })
      ws.ui.set({ focus: "ai", aiVisible: true })
    },
  }))
  ws.ui.set({
    modal: {
      kind: "menu",
      ...menuAt(x, y),
      items: runOnly
        ? runItems
        : [
            ...choices.flatMap((c): MenuItem[] => [
              {
                label: `New ${c.name}`,
                run: () => add({ name: c.name, command: c.command, args: c.args, cwd: ws.root, branch: null }),
              },
              { label: `New ${c.name} in a git worktree`, disabled: !repo, run: () => void inWorktree(c) },
            ]),
            ...resumeItems,
            { label: "New terminal", hint: "Alt+`", run: () => add(terminalSession(ws.root)) },
            ...runItems,
          ],
    },
  })
}

/** A terminal's error into the agent's prompt (the visible tab's, else the newest): the error as printed, and where it points. */
function sendTerminalError(ws: Workspace): boolean {
  const first = terminalErrors()[0]
  if (!first) {
    ws.notify("No terminal errors right now")
    return false
  }
  const { session, error } = first
  const what = session.terminal?.run
    ? `The ${session.name} dev server (${session.terminal.run})`
    : `My terminal (${session.name})`
  const at = error.location ? ` @${relative(ws.root, error.location.path)}#L${error.location.line}` : ""
  ws.ai?.type(`${what} shows this error. Find the cause and fix it.${at} `)
  ws.ai?.paste(`\n\n${error.text}\n`)
  ws.ui.set({ modal: null, focus: "ai", aiVisible: true })
  ws.ai?.focus()
  return true
}

/** Stop a tab's CLI and drop the tab (not the last one). */
function closeTab(id: number): void {
  const { sessions, active } = tabs.get()
  if (sessions.length < 2 || !sessions.some((s) => s.id === id)) return
  handles.get(id)?.kill()
  const rest = sessions.filter((s) => s.id !== id)
  const i = sessions.findIndex((s) => s.id === id)
  const { [id]: _gone, ...state } = tabs.get().state
  tabs.set({ sessions: rest, active: active === id ? rest[Math.max(0, i - 1)]!.id : active, state })
}

/** How many files a worktree agent changed since its branch split off; stored for its tab. */
async function recount(ws: Workspace, id: number): Promise<void> {
  const session = tabs.get().sessions.find((s) => s.id === id)
  const repo = ws.git?.main.repo
  if (!session?.branch || !repo) return
  // Counts can overlap (the agent goes quiet again before one finishes): only the latest one lands.
  const seq = (recounts.get(id) ?? 0) + 1
  recounts.set(id, seq)
  const base = await repo.mergeBase(session.branch)
  if (!base) return
  const changes = (await new GitRepo(worktreeOf(session)).changesSince(base)).length
  if (recounts.get(id) !== seq) return
  if (tabs.get().state[id]?.changes !== changes) setState(id, { changes })
}
const recounts = new Map<number, number>()

/** Close a tab (not the last). A worktree tab offers to merge its work first, or to remove its worktree. */
function closeSession(ws: Workspace, id: number): void {
  const { sessions } = tabs.get()
  if (sessions.length < 2) return ws.notify("This is the only agent; restart it instead (right-click › Restart)")
  const session = sessions.find((s) => s.id === id)
  if (!session) return
  const close = () => closeTab(id)
  if (!session.branch) return close()
  const repo = ws.git?.main.repo
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: `Close ${tabLabel(session)}`,
      body: `It works in ${worktreeOf(session)}. Review and merge its work into your branch first, or remove that worktree (its branch ${session.branch} stays, with any commits)?`,
      options: [
        { key: "m", label: "Review & merge first", run: () => ws.ui.set({ modal: { kind: "mergeAgent", sessionId: id } }) },
        {
          key: "r",
          label: "Remove worktree",
          run: async () => {
            ws.ui.set({ modal: null })
            close()
            const err = await repo?.removeWorktree(worktreeOf(session))
            ws.notify(
              err ? `Worktree kept: ${err}` : `Removed ${worktreeOf(session)} (branch ${session.branch} kept)`,
              err ? "warn" : "info",
            )
          },
        },
        {
          key: "k",
          label: "Keep worktree",
          run: () => {
            ws.ui.set({ modal: null })
            close()
          },
        },
        { key: "escape", label: "Cancel", run: () => ws.ui.set({ modal: null }) },
      ],
    },
  })
}
