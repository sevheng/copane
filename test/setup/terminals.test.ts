import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FACE } from "../../src/setup/installFont"
import {
  ITERM_PROFILE,
  PS_NAME,
  addSettings,
  ghosttySettings,
  gnomeFont,
  itermProfileJson,
  kittySettings,
} from "../../src/setup/terminals"
import { useItermProfile } from "../../src/app/itermProfile"
import { fontNames } from "../support/ttf"

test("addSettings appends only the keys the config doesn't set", () => {
  const r = addSettings("theme = dark\nmacos-option-as-alt = left\n", ghosttySettings(true))
  expect(r.added).toEqual(["font-family"])
  expect(r.text).toBe(`theme = dark\nmacos-option-as-alt = left\n\n# Added by copane --install-font\nfont-family = "${FACE}"\n`)
  expect(addSettings(r.text, ghosttySettings(true)).added).toEqual([])
})

test("addSettings: an empty config, a file without a last newline, kitty's spacing", () => {
  expect(addSettings("", kittySettings(false)).text).toBe(`# Added by copane --install-font\nfont_family ${FACE}\n`)
  expect(addSettings("font_size 13", kittySettings(true)).text).toBe(
    `font_size 13\n\n# Added by copane --install-font\nfont_family ${FACE}\nmacos_option_as_alt yes\n`,
  )
  // A font set already is left alone; a commented-out line sets nothing.
  expect(addSettings("  font_family JetBrains Mono\n", kittySettings(false)).added).toEqual([])
  expect(addSettings("# font_family Menlo\n", kittySettings(false)).added).toEqual(["font_family"])
  // A key that only starts the same way is a different setting.
  expect(addSettings("font-family-bold = X\n", ghosttySettings(false)).added).toEqual(["font-family"])
})

test("the iTerm2 profile names the bundled font by its PostScript name", async () => {
  const bytes = new Uint8Array(
    await Bun.file(join(import.meta.dir, "../../assets/fonts/CaskaydiaMonoNerdFont-Regular.ttf")).arrayBuffer(),
  )
  expect(fontNames(bytes).get(6)).toBe(PS_NAME)
  const profile = JSON.parse(itermProfileJson()).Profiles[0]
  expect(profile.Name).toBe(ITERM_PROFILE)
  expect(profile["Normal Font"]).toBe(`${PS_NAME} 13`)
  expect(profile["Option Key Sends"]).toBe(2)
})

test("GNOME Terminal: only a profile that follows the system font changes, at the system size", () => {
  expect(gnomeFont("true", "'Monospace 12'", "'Ubuntu Mono 13'")).toBe(`${FACE} 13`)
  expect(gnomeFont("true", "'Monospace 11'", "")).toBe(`${FACE} 11`)
  expect(gnomeFont("false", "'Fira Code 12'", "'Ubuntu Mono 13'")).toBeNull()
})

const setup = (dir: string, platform: string) =>
  Bun.spawnSync([process.execPath, "run", join(import.meta.dir, "../../src/setup/installFont.ts")], {
    env: {
      ...process.env,
      HOME: dir,
      XDG_CONFIG_HOME: join(dir, ".config"),
      KITTY_CONFIG_DIRECTORY: "",
      PATH: join(dir, "no-bin"), // a kitty or Ghostty installed on this machine must not count
      CE_SETUP_PLATFORM: platform,
      CE_SETUP_COMMANDS: "0",
      CE_FONT_SKIP_INSTALL: "1",
    },
    stdout: "pipe",
  }).stdout.toString()

test("Linux: kitty's config gets the font (backed up), and icons are turned on", () => {
  const dir = mkdtempSync(join(tmpdir(), "term-setup-"))
  mkdirSync(join(dir, ".config/kitty"), { recursive: true })
  writeFileSync(join(dir, ".config/kitty/kitty.conf"), "font_size 12\n")
  const out = setup(dir, "linux")
  expect(out).toContain("kitty: set font_family")
  expect(readFileSync(join(dir, ".config/kitty/kitty.conf"), "utf8")).toContain(`font_family ${FACE}`)
  expect(readdirSync(join(dir, ".config/kitty")).some((f) => f.startsWith("kitty.conf.bak-"))).toBe(true)
  expect(JSON.parse(readFileSync(join(dir, ".config/copane/config.json"), "utf8"))).toEqual({ tree: { icons: "nerd" } })
  expect(setup(dir, "linux")).toContain("kitty: already set up")
})

test("macOS: Ghostty gets Option as Alt, iTerm2 gets the copane profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "term-setup-mac-"))
  mkdirSync(join(dir, ".config/ghostty"), { recursive: true })
  writeFileSync(join(dir, ".config/ghostty/config"), "")
  mkdirSync(join(dir, "Library/Application Support/iTerm2"), { recursive: true })
  const out = setup(dir, "darwin")
  expect(out).toContain("Ghostty: set font-family, macos-option-as-alt")
  expect(out).toContain(`iTerm2: added the "${ITERM_PROFILE}" profile`)
  expect(readFileSync(join(dir, "Library/Application Support/iTerm2/DynamicProfiles/copane.json"), "utf8")).toBe(
    itermProfileJson(),
  )
  expect(setup(dir, "darwin")).toContain("already set up")
})

test("no terminal found: says so and leaves icons off", () => {
  const dir = mkdtempSync(join(tmpdir(), "term-setup-none-"))
  const out = setup(dir, "linux")
  expect(out).toContain("no terminal to set up found")
  expect(out).not.toContain("tree.icons")
})

test("iTerm2: copane switches to its profile only in iTerm2, outside tmux, with the profile installed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iterm-"))
  const path = join(dir, "copane.json")
  const out: string[] = []
  const env = { TERM_PROGRAM: "iTerm.app", ITERM_PROFILE: "Default" }
  await useItermProfile(env, (s) => out.push(s), path)
  expect(out).toEqual([]) // no profile installed
  writeFileSync(path, itermProfileJson())
  await useItermProfile({ ...env, TMUX: "/tmp/tmux" }, (s) => out.push(s), path)
  await useItermProfile({ ...env, ITERM_PROFILE: ITERM_PROFILE }, (s) => out.push(s), path)
  await useItermProfile({ TERM_PROGRAM: "Apple_Terminal" }, (s) => out.push(s), path)
  expect(out).toEqual([])
  await useItermProfile(env, (s) => out.push(s), path)
  expect(out).toEqual([`\x1b]1337;SetProfile=${ITERM_PROFILE}\x07`])
})
