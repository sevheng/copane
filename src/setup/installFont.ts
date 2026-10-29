/**
 * Install the bundled Nerd Font and point the terminal at it, so the file tree can show icons.
 * Run by `copane --install-font`, which both install scripts call after installing (skip with FONT=0),
 * or from source with `bun run src/setup/installFont.ts`. The font files are embedded in the binary.
 *
 * - WSL: installs the font for the current Windows user (no admin) and sets it as the default
 *   font in Windows Terminal, unless you picked another font there. Backs up settings.json.
 * - macOS / Linux: installs the font and sets up the terminals found (terminals.ts).
 * - Turns on `tree.icons: "nerd"` in the editor config once the terminal uses a Nerd Font,
 *   unless you set tree.icons yourself.
 *
 * Every step is idempotent and only warns on failure.
 *
 * Test hooks: CE_FONT_WT_SETTINGS (use this settings.json, skip discovery),
 * CE_FONT_SKIP_INSTALL=1 (don't install font files), CE_SETUP_PLATFORM=darwin|linux (that setup, even on WSL).
 */
// mkdtemp: Bun has no temp-folder API.
import { mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { configPath } from "../config/load"
import { configureTerminals } from "./terminals"
import bold from "../../assets/fonts/CaskaydiaMonoNerdFont-Bold.ttf" with { type: "file" }
import regular from "../../assets/fonts/CaskaydiaMonoNerdFont-Regular.ttf" with { type: "file" }

export const FACE = "CaskaydiaMono Nerd Font"
/** The face earlier installs set: switched to FACE, since its icons are squeezed into one cell. */
export const OLD_FACE = "CaskaydiaMono Nerd Font Mono"
export const FONT_FILES = [
  { file: "CaskaydiaMonoNerdFont-Regular.ttf", src: regular, registry: "CaskaydiaMono NF Regular (TrueType)" },
  { file: "CaskaydiaMonoNerdFont-Bold.ttf", src: bold, registry: "CaskaydiaMono NF Bold (TrueType)" },
]
const FORMAT = { tabSize: 4, insertSpaces: true, eol: "\n" }

const isNerdFace = (face: string) => /nerd font|\bnf[a-z]?\b/i.test(face)

function parseJsonc(text: string): unknown {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error("not valid JSON")
  return value
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {})

/** Font faces set anywhere in Windows Terminal settings (defaults and each profile), with their JSON paths. */
function faceEntries(settings: Json): { face: string; path: (string | number)[] }[] {
  const profiles = obj(settings.profiles)
  const legacy = Array.isArray(settings.profiles)
  const list: unknown[] = legacy ? (settings.profiles as unknown[]) : Array.isArray(profiles.list) ? profiles.list : []
  const where: [unknown, (string | number)[]][] = [
    [profiles.defaults, ["profiles", "defaults"]],
    ...list.map((p, i): [unknown, (string | number)[]] => [p, legacy ? ["profiles", i] : ["profiles", "list", i]]),
  ]
  const out: { face: string; path: (string | number)[] }[] = []
  for (const [p, base] of where) {
    const f = obj(p)
    const face = obj(f.font).face
    const old = f.fontFace // the pre-1.10 spelling
    if (typeof face === "string" && face.trim()) out.push({ face, path: [...base, "font", "face"] })
    else if (typeof old === "string" && old.trim()) out.push({ face: old, path: [...base, "fontFace"] })
  }
  return out
}

const facesIn = (settings: Json) => faceEntries(settings).map((e) => e.face)

export interface EditResult {
  text: string
  changed: boolean
  /** Whether the terminal ends up using a Nerd Font (so icons can be turned on). */
  nerd: boolean
  reason: string
}

/** Set the Nerd Font as Windows Terminal's default face, unless the user chose a font. */
export function terminalFontEdit(text: string, face = FACE): EditResult {
  const settings = obj(parseJsonc(text))
  const stale = faceEntries(settings).filter((e) => e.face === OLD_FACE)
  if (stale.length) {
    let out = text
    for (const e of stale) out = applyEdits(out, modify(out, e.path, face, { formattingOptions: FORMAT }))
    return { text: out, changed: true, nerd: true, reason: `font switched from ${OLD_FACE} to ${face} (bigger icons)` }
  }
  const faces = facesIn(settings)
  if (faces.some(isNerdFace))
    return { text, changed: false, nerd: true, reason: `already uses a Nerd Font (${faces.find(isNerdFace)})` }
  if (faces.length) {
    return { text, changed: false, nerd: false, reason: `you chose "${faces[0]}"; left it alone` }
  }
  if (Array.isArray(settings.profiles)) {
    return { text, changed: false, nerd: false, reason: "old settings format without profiles.defaults; left it alone" }
  }
  const edits = modify(text, ["profiles", "defaults", "font", "face"], face, { formattingOptions: FORMAT })
  return { text: applyEdits(text, edits), changed: true, nerd: true, reason: `default font set to ${face}` }
}

/** Turn on Nerd icons in the editor config, unless tree.icons is already set. */
export function configIconsEdit(text: string | null): { text: string; changed: boolean } {
  const base = text && text.trim() ? text : "{}\n"
  const current = obj(obj(parseJsonc(base)).tree).icons
  if (current !== undefined) return { text: base, changed: false }
  const edits = modify(base, ["tree", "icons"], "nerd", { formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" } })
  return { text: applyEdits(base, edits), changed: true }
}

/** PowerShell that installs the fonts for the current user (no admin) and registers them. */
export function windowsFontScript(files: { winPath: string; file: string; registry: string }[]): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$dir = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts'",
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    "$key = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'",
    "if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }",
    "$installed = 0",
  ]
  for (const f of files) {
    lines.push(
      `$dest = Join-Path $dir ${q(f.file)}`,
      `$have = (Get-ItemProperty -Path $key -Name ${q(f.registry)} -ErrorAction SilentlyContinue)`,
      `if (-not (Test-Path $dest) -or -not $have) {`,
      `  Copy-Item -LiteralPath ${q(f.winPath)} -Destination $dest -Force`,
      `  New-ItemProperty -Path $key -Name ${q(f.registry)} -Value $dest -PropertyType String -Force | Out-Null`,
      `  $installed++`,
      `}`,
    )
  }
  lines.push("Write-Output $installed")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------

/** Run a command; trimmed stdout, or null when it fails. */
async function sh(cmd: string[], input?: string): Promise<string | null> {
  try {
    const p = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    })
    const [out, code] = await Promise.all([Bun.readableStreamToText(p.stdout), p.exited])
    return code === 0 ? out.trim() : null
  } catch {
    return null
  }
}

async function isWsl(): Promise<boolean> {
  const version = await Bun.file("/proc/version")
    .text()
    .catch(() => "")
  return /microsoft/i.test(version) && Bun.which("powershell.exe") !== null
}

/** UTF-16LE base64, the encoding PowerShell's -EncodedCommand expects. */
function utf16Base64(text: string): string {
  const units = new Uint16Array(text.length)
  for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i)
  return new Uint8Array(units.buffer).toBase64()
}

/** Run a PowerShell script. -EncodedCommand runs multi-line blocks reliably; stdin does not. */
const powershell = (script: string) =>
  sh(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", utf16Base64(script)])

async function installWindows(): Promise<string> {
  // The embedded files have no path Windows can see: copy them to a real folder first.
  const dir = await mkdtemp(join(tmpdir(), "copane-font-"))
  try {
    const files = []
    for (const f of FONT_FILES) {
      const path = join(dir, f.file)
      await Bun.write(path, Bun.file(f.src))
      const winPath = await sh(["wslpath", "-w", path])
      if (!winPath) throw new Error(`cannot map ${f.file} to a Windows path`)
      files.push({ ...f, winPath })
    }
    return await runWindowsInstall(files)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function runWindowsInstall(files: { winPath: string; file: string; registry: string }[]): Promise<string> {
  const out = await powershell(windowsFontScript(files))
  const n = Number(out?.split(/\s+/).pop())
  if (out === null || !Number.isInteger(n)) throw new Error(`PowerShell font install failed${out ? `: ${out}` : ""}`)
  return n > 0 ? `installed for your Windows user (${n} file${n === 1 ? "" : "s"})` : "already installed"
}

async function installUnix(dir: string, after?: () => Promise<unknown>): Promise<string> {
  let n = 0
  for (const f of FONT_FILES) {
    const dest = join(dir, f.file)
    if (await Bun.file(dest).exists()) continue
    await Bun.write(dest, Bun.file(f.src)) // copies; creates the folder
    n++
  }
  if (n) await after?.()
  return n ? `installed to ${dir}` : "already installed"
}

/** Windows Terminal settings.json files (stable, preview, unpackaged), as WSL paths. */
async function windowsTerminalSettings(): Promise<string[]> {
  if (Bun.env.CE_FONT_WT_SETTINGS) return [Bun.env.CE_FONT_WT_SETTINGS]
  const local = await powershell("Write-Output $env:LOCALAPPDATA")
  if (!local) return []
  const base = await sh(["wslpath", "-u", local])
  if (!base) return []
  const candidates = [
    "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json",
    "Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json",
    "Microsoft/Windows Terminal/settings.json",
  ].map((p) => join(base, p))
  const found: string[] = []
  for (const c of candidates) if (await Bun.file(c).exists()) found.push(c)
  return found
}

async function configureWindowsTerminal(): Promise<{ nerd: boolean; lines: string[]; files: string[] }> {
  const files = await windowsTerminalSettings()
  if (!files.length)
    return { nerd: false, lines: ["Windows Terminal: settings not found; pick the font yourself (see README, Icons)"], files }
  let nerd = false
  const lines: string[] = []
  for (const file of files) {
    const label = file.includes("Preview") ? "Windows Terminal Preview" : "Windows Terminal"
    try {
      const text = await Bun.file(file).text()
      const r = terminalFontEdit(text)
      if (r.changed) {
        const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
        await Bun.write(backup, text)
        await Bun.write(file, r.text)
        lines.push(`${label}: ${r.reason} (backup: ${backup})`)
      } else lines.push(`${label}: ${r.reason}`)
      nerd ||= r.nerd
    } catch (err) {
      lines.push(`${label}: skipped (${(err as Error).message})`)
    }
  }
  return { nerd, lines, files }
}

async function enableIcons(): Promise<string> {
  const path = configPath()
  const file = Bun.file(path)
  const r = configIconsEdit((await file.exists()) ? await file.text() : null)
  if (!r.changed) return `editor config: tree.icons already set in ${path}`
  await Bun.write(path, r.text)
  return `editor config: tree.icons = "nerd" (${path})`
}

/** Remembers a finished Windows setup, so the next install can skip PowerShell. */
const stampPath = () => join(dirname(configPath()), "font-setup.json")
type Stamp = { face: string; fonts: string[]; settings: string[] }

async function writeStamp(settings: string[]): Promise<void> {
  const stamp: Stamp = { face: FACE, fonts: FONT_FILES.map((f) => f.file), settings }
  await Bun.write(stampPath(), JSON.stringify(stamp, null, 2) + "\n").catch(() => null)
}

/** True when the same fonts were installed before and Windows Terminal still uses the face. */
async function setUpBefore(): Promise<boolean> {
  const stamp = (await Bun.file(stampPath())
    .json()
    .catch(() => null)) as Stamp | null
  if (!stamp || stamp.face !== FACE || stamp.fonts.join() !== FONT_FILES.map((f) => f.file).join() || !stamp.settings.length)
    return false
  for (const file of stamp.settings) {
    const text = await Bun.file(file)
      .text()
      .catch(() => null)
    if (text === null) return false
    const r = terminalFontEdit(text)
    if (r.changed || !r.nerd) return false
  }
  return true
}

export async function main(): Promise<void> {
  const lines: string[] = []
  const say = (s: string) => lines.push("  " + s)
  const skipInstall = Bun.env.CE_FONT_SKIP_INSTALL === "1"
  try {
    const platform = Bun.env.CE_SETUP_PLATFORM || process.platform
    if (!Bun.env.CE_SETUP_PLATFORM && ((await isWsl()) || Bun.env.CE_FONT_WT_SETTINGS)) {
      // Already set up (checked without PowerShell, which takes a second or more): nothing to do.
      if (!skipInstall && Bun.env.FONT !== "force" && (await setUpBefore())) {
        say("font: already set up (FONT=force copane --install-font redoes it)")
        say(await enableIcons())
        console.log("Icons:\n" + lines.join("\n"))
        return
      }
      const font = skipInstall ? "skipped" : await installWindows()
      if (!skipInstall) say(`font: ${font}`)
      const wt = await configureWindowsTerminal()
      wt.lines.forEach(say)
      if (wt.nerd) say(await enableIcons())
      if (!skipInstall && wt.nerd) await writeStamp(wt.files)
      // Windows Terminal reads installed fonts only at startup; new tabs share that process.
      if (font.startsWith("installed") || wt.lines.some((l) => l.includes("default font set") || l.includes("font switched"))) {
        say("ACTION: close every Windows Terminal window, then open it again to load the font (a new tab is not enough)")
      }
    } else {
      const mac = platform === "darwin"
      if (!skipInstall) {
        const font = mac
          ? await installUnix(join(homedir(), "Library/Fonts"))
          : await installUnix(join(homedir(), ".local/share/fonts"), () => sh(["fc-cache", "-f"]))
        say(`font: ${font}`)
      }
      const terminals = await configureTerminals(mac)
      terminals.forEach((t) => say(t.line))
      if (terminals.some((t) => t.nerd)) say(await enableIcons())
    }
  } catch (err) {
    say(`font setup skipped: ${(err as Error).message}`)
  }
  console.log("Icons:\n" + lines.join("\n"))
}

if (import.meta.main) await main()
