/**
 * Point the terminals installed on macOS and Linux at the bundled Nerd Font, and make Option send
 * Alt on a Mac, so copane looks and answers keys the same in every terminal. Run by
 * `copane --install-font` (installFont.ts) after the font files are in place; Windows Terminal
 * (WSL) is set up there.
 *
 * - Ghostty, kitty: adds `font-family` / `font_family` (and Option as Alt on a Mac) to the config
 *   file, unless it sets them already. Both draw Nerd icons from a built-in font anyway. On a Mac,
 *   Ghostty's ⌘C copies only when Ghostty has a selection of its own, else it reaches copane (which
 *   copies the editor's or the AI pane's selection).
 * - iTerm2: a dynamic profile named "copane" (the font, left Option as Esc+, ⌘C / ⌘X sent to copane
 *   as kitty-protocol keys, on top of the default profile's own key mappings), on top of the default
 *   profile; copane switches its tab to it while it runs (itermProfile.ts).
 * - Terminal.app: sets the font of the default profile, when it is still a stock font (SF Mono,
 *   Menlo, Monaco) and Terminal is running. Option as Meta can't be set from outside.
 * - GNOME Terminal: sets the default profile's font, when it still follows the system font.
 *
 * A config file is backed up before it changes; a font you chose is left alone.
 * Test hooks: CE_SETUP_COMMANDS=0 (don't run osascript / gsettings).
 */
import { homedir } from "node:os"
import { join } from "node:path"
import { FACE } from "./installFont"

/** The font's PostScript name, which macOS terminals store. */
export const PS_NAME = "CaskaydiaMonoNF-Regular"
export const ITERM_PROFILE = "copane"
const MARK = "# Added by copane --install-font"

export interface Outcome {
  line: string
  /** The terminal draws Nerd icons after this (so tree.icons can be turned on). */
  nerd: boolean
}

/** A line-based config setting: `key` names it, `match` (else the key at a line's start) finds it already set. */
export interface Setting {
  key: string
  line: string
  match?: RegExp
}

/** Add the `key value` settings a line-based config (Ghostty, kitty) doesn't set yet. */
export function addSettings(text: string, settings: Setting[]): { text: string; added: string[] } {
  const missing = settings.filter((s) => !(s.match ?? new RegExp(`^\\s*${s.key}(\\s|=|$)`, "m")).test(text))
  if (!missing.length) return { text, added: [] }
  const base = text && !text.endsWith("\n") ? text + "\n" : text
  const block = [MARK, ...missing.map((s) => s.line)].join("\n") + "\n"
  return { text: (base ? base + "\n" : "") + block, added: missing.map((s) => s.key) }
}

export function ghosttySettings(mac: boolean): Setting[] {
  return [
    { key: "font-family", line: `font-family = "${FACE}"` },
    ...(mac
      ? [
          { key: "macos-option-as-alt", line: "macos-option-as-alt = true" },
          // ⌘C copies Ghostty's own selection when there is one; otherwise copane gets it. A ⌘C
          // binding of your own (with any prefix) is left alone.
          {
            key: "keybind super+c",
            line: "keybind = performable:super+c=copy_to_clipboard",
            match: /^\s*keybind\s*=\s*(?:[a-z_]+:)*super\+c\s*=/m,
          },
        ]
      : []),
  ]
}

export function kittySettings(mac: boolean) {
  return [
    { key: "font_family", line: `font_family ${FACE}` },
    ...(mac ? [{ key: "macos_option_as_alt", line: "macos_option_as_alt yes" }] : []),
  ]
}

/** iTerm2 key-map entries ("char-modifiers" in hex, 0x100000 = ⌘), as its profiles store them. */
export type ItermKeyMap = Record<string, { Action: number; Text: string }>

const ITERM_CMD = 0x100000
const ITERM_SEND_ESCAPE = 10 // "Send Escape Sequence": ESC, then Text

/**
 * ⌘C / ⌘X as kitty-protocol keys (ESC [ code ; 9 u, 9 = 1 + Super), which iTerm2's menus would
 * otherwise take: copane copies or cuts its own selection with them.
 */
export const ITERM_CMD_KEYS: ItermKeyMap = Object.fromEntries(
  ["c", "x"].map((ch) => {
    const code = ch.codePointAt(0)!
    return [`0x${code.toString(16)}-0x${ITERM_CMD.toString(16)}`, { Action: ITERM_SEND_ESCAPE, Text: `[${code};9u` }]
  }),
)

/**
 * iTerm2 dynamic profile: fields it leaves out come from the default profile. A key map replaces
 * the default's whole map, so `defaultKeys` (the default profile's own mappings) go in too; null
 * (they couldn't be read) leaves the key map out, and ⌘C / ⌘X with iTerm2.
 */
export function itermProfileJson(defaultKeys: ItermKeyMap | null = {}): string {
  const profile = {
    Name: ITERM_PROFILE,
    Guid: "copane-dynamic-profile",
    "Normal Font": `${PS_NAME} 13`,
    "Non Ascii Font": `${PS_NAME} 13`,
    "Use Non-ASCII Font": false,
    "Option Key Sends": 2, // left Option: Esc+, so ⌥ shortcuts arrive as Alt
    ...(defaultKeys ? { "Keyboard Map": { ...defaultKeys, ...ITERM_CMD_KEYS } } : {}),
  }
  return JSON.stringify({ Profiles: [profile] }, null, 2) + "\n"
}

/** AppleScript for Terminal.app: prints "set", "same", "not running" or the font it left alone. */
export const TERMINAL_APP_SCRIPT = `if application "Terminal" is not running then return "not running"
tell application "Terminal"
  set f to font name of default settings
  if f is "${PS_NAME}" then return "same"
  if f starts with "SFMono" or f starts with "Menlo" or f starts with "Monaco" then
    set font name of default settings to "${PS_NAME}"
    return "set"
  end if
  return f
end tell`

/** GNOME Terminal: the font to set, or null to leave the profile alone. Values are gsettings output. */
export function gnomeFont(useSystemFont: string, font: string, systemMono: string): string | null {
  if (useSystemFont.trim() !== "true") return null // the user picked a font
  const size = /(\d+(?:\.\d+)?)'?\s*$/.exec(systemMono)?.[1] ?? /(\d+(?:\.\d+)?)'?\s*$/.exec(font)?.[1] ?? "12"
  return `${FACE} ${size}`
}

// ---------------------------------------------------------------------------

const runCommands = () => Bun.env.CE_SETUP_COMMANDS !== "0"

async function run(cmd: string[]): Promise<string | null> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
    const [out, code] = await Promise.all([Bun.readableStreamToText(p.stdout), p.exited])
    return code === 0 ? out.trim() : null
  } catch {
    return null
  }
}

const exists = (p: string) => Bun.file(p).exists()
const isDir = (p: string) =>
  Bun.file(p)
    .stat()
    .then((s) => s.isDirectory())
    .catch(() => false)
const xdgConfig = () => Bun.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")

/** Edit a config file in place (backup first); creates it when the terminal has none yet. */
async function editConfig(label: string, path: string, settings: { key: string; line: string }[]): Promise<Outcome> {
  try {
    const old = (await exists(path)) ? await Bun.file(path).text() : ""
    const r = addSettings(old, settings)
    if (!r.added.length) return { line: `${label}: already set up (${path})`, nerd: true }
    if (old) await Bun.write(`${path}.bak-${stamp()}`, old)
    await Bun.write(path, r.text)
    return { line: `${label}: set ${r.added.join(", ")} in ${path}${old ? " (backup next to it)" : ""}`, nerd: true }
  } catch (err) {
    return { line: `${label}: skipped (${(err as Error).message})`, nerd: false }
  }
}

async function ghostty(mac: boolean): Promise<Outcome | null> {
  const candidates = [join(xdgConfig(), "ghostty/config.ghostty"), join(xdgConfig(), "ghostty/config")]
  if (mac) {
    const app = join(homedir(), "Library/Application Support/com.mitchellh.ghostty")
    candidates.push(join(app, "config.ghostty"), join(app, "config"))
  }
  let path: string | undefined
  for (const c of candidates) if (!path && (await exists(c))) path = c
  const installed = path || Bun.which("ghostty") || (mac && (await exists("/Applications/Ghostty.app/Contents/Info.plist")))
  if (!installed) return null
  return editConfig("Ghostty", path ?? join(xdgConfig(), "ghostty/config"), ghosttySettings(mac))
}

async function kitty(mac: boolean): Promise<Outcome | null> {
  const dir = Bun.env.KITTY_CONFIG_DIRECTORY || join(xdgConfig(), "kitty")
  const path = join(dir, "kitty.conf")
  const installed =
    (await exists(path)) || Bun.which("kitty") || (mac && (await exists("/Applications/kitty.app/Contents/Info.plist")))
  if (!installed) return null
  return editConfig("kitty", path, kittySettings(mac))
}

export const itermProfilePath = () => join(homedir(), "Library/Application Support/iTerm2/DynamicProfiles/copane.json")

/**
 * The default profile's key mappings, from iTerm2's "New Bookmarks" (as `plutil -extract … json`
 * prints it) and its "Default Bookmark Guid". Null when they can't be read.
 */
export function itermDefaultKeys(bookmarks: string, guid: string): ItermKeyMap | null {
  try {
    const profiles = JSON.parse(bookmarks) as { Guid?: string; "Keyboard Map"?: ItermKeyMap }[]
    if (!Array.isArray(profiles)) return null
    const def = profiles.find((b) => b.Guid === guid.trim()) ?? profiles[0]
    return def ? (def["Keyboard Map"] ?? {}) : null
  } catch {
    return null
  }
}

/** Read the default profile's key mappings; {} when iTerm2 has no preferences yet, null when unreadable. */
async function readItermDefaultKeys(): Promise<ItermKeyMap | null> {
  const plist = join(homedir(), "Library/Preferences/com.googlecode.iterm2.plist")
  if (!(await exists(plist))) return {}
  if (!runCommands()) return null
  // Not the whole file: plutil can't turn its binary entries into JSON.
  const bookmarks = await run(["plutil", "-extract", "New Bookmarks", "json", "-o", "-", plist])
  const guid = (await run(["plutil", "-extract", "Default Bookmark Guid", "raw", "-o", "-", plist])) ?? ""
  return bookmarks === null ? null : itermDefaultKeys(bookmarks, guid)
}

async function iterm(): Promise<Outcome | null> {
  const installed =
    (await exists("/Applications/iTerm.app/Contents/Info.plist")) ||
    (await isDir(join(homedir(), "Library/Application Support/iTerm2")))
  if (!installed) return null
  try {
    const path = itermProfilePath()
    const keys = await readItermDefaultKeys()
    const json = itermProfileJson(keys)
    if ((await exists(path)) && (await Bun.file(path).text()) === json)
      return { line: `iTerm2: "${ITERM_PROFILE}" profile already set up`, nerd: true }
    await Bun.write(path, json)
    const cmd = keys ? ", ⌘C / ⌘X go to copane" : "; ⌘C / ⌘X stay with iTerm2 (couldn't read its key mappings)"
    return { line: `iTerm2: added the "${ITERM_PROFILE}" profile (copane switches to it while it runs${cmd})`, nerd: true }
  } catch (err) {
    return { line: `iTerm2: skipped (${(err as Error).message})`, nerd: false }
  }
}

async function terminalApp(): Promise<Outcome | null> {
  if (!runCommands()) return null
  const out = await run(["osascript", "-e", TERMINAL_APP_SCRIPT])
  if (out === null) return { line: `Terminal.app: couldn't set the font; pick "${FACE}" in Settings › Profiles`, nerd: false }
  if (out === "not running") return null
  const meta = "turn on Settings › Profiles › Keyboard › Use Option as Meta key for ⌥ shortcuts"
  if (out === "same") return { line: `Terminal.app: already uses ${FACE}; ${meta}`, nerd: true }
  if (out === "set") return { line: `Terminal.app: default profile's font set to ${FACE}; ${meta}`, nerd: true }
  return { line: `Terminal.app: you chose "${out}"; left it alone`, nerd: false }
}

async function gnomeTerminal(): Promise<Outcome | null> {
  if (!runCommands() || !Bun.which("gnome-terminal") || !Bun.which("gsettings")) return null
  const id = (await run(["gsettings", "get", "org.gnome.Terminal.ProfilesList", "default"]))?.replace(/'/g, "")
  if (!id) return null
  const schema = `org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:${id}/`
  const useSystem = (await run(["gsettings", "get", schema, "use-system-font"])) ?? ""
  const font = (await run(["gsettings", "get", schema, "font"])) ?? ""
  const mono = (await run(["gsettings", "get", "org.gnome.desktop.interface", "monospace-font-name"])) ?? ""
  if (font.includes(FACE)) return { line: `GNOME Terminal: already uses ${FACE}`, nerd: true }
  const next = gnomeFont(useSystem, font, mono)
  if (!next) return { line: `GNOME Terminal: you chose ${font}; left it alone`, nerd: false }
  const ok =
    (await run(["gsettings", "set", schema, "font", next])) !== null &&
    (await run(["gsettings", "set", schema, "use-system-font", "false"])) !== null
  return ok
    ? { line: `GNOME Terminal: default profile's font set to ${next} (was the system font)`, nerd: true }
    : { line: "GNOME Terminal: couldn't set the font", nerd: false }
}

/** Set up every terminal found on this Mac or Linux machine. */
export async function configureTerminals(mac: boolean): Promise<Outcome[]> {
  const steps = mac ? [terminalApp(), iterm(), ghostty(true), kitty(true)] : [gnomeTerminal(), ghostty(false), kitty(false)]
  const found = (await Promise.all(steps)).filter((o): o is Outcome => o !== null)
  return found.length
    ? found
    : [{ line: `no terminal to set up found; pick "${FACE}" in your terminal's font settings`, nerd: false }]
}
