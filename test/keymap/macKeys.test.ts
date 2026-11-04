import { expect, test } from "bun:test"
import { parseKeypress } from "@opentui/core"
import { buildBindings, commandKeys, lookup, startsChord } from "../../src/keymap/bindings"
import { cmdAsCtrl, keyText, keyToString, normalizeBinding, prettyKeys } from "../../src/keymap/keys"
import type { CommandId } from "../../src/keymap/commands"

// What a Mac terminal sends: Cmd only over the kitty keyboard protocol (Ghostty, kitty, WezTerm,
// iTerm2 with CSI u), Option+←/→ as ESC b / ESC f, Cmd+←/→ as Ctrl+A / Ctrl+E (Ghostty, iTerm2).
const key = (bytes: string) => keyToString(parseKeypress(bytes, { useKittyKeyboard: true })!)
const mac = buildBindings({}, { mac: true })
const pc = buildBindings()
const run = (b: typeof mac, layers: ("global" | "editor")[], bytes: string) =>
  layers.map((l) => lookup(b[l], key(bytes))).find(Boolean)

const CMD: [string, string, CommandId][] = [
  ["Cmd+S", "\x1b[115;9u", "file.save"],
  ["Cmd+P", "\x1b[112;9u", "file.picker"],
  ["Cmd+Shift+P", "\x1b[112;10u", "app.palette"],
  ["Cmd+Z", "\x1b[122;9u", "edit.undo"],
  ["Cmd+Shift+Z", "\x1b[122;10u", "edit.redo"],
  ["Cmd+F", "\x1b[102;9u", "find.open"],
  ["Cmd+Option+R", "\x1b[114;11u", "app.restart"],
  ["Cmd+A", "\x1b[97;9u", "edit.selectAll"],
  ["Cmd+1", "\x1b[49;9u", "buffer.goto1"],
  ["Cmd+Shift+]", "\x1b[93;10u", "buffer.next"],
  ["Ctrl+- (CSI-u)", "\x1b[45;5u", "nav.back"],
]

test.each(CMD)("%s reaches its command on a Mac", (_name, bytes, command) => {
  expect(run(mac, ["editor", "global"], bytes)).toBe(command)
})

test("Cmd+C / Cmd+X reach copy and cut in the editor; in the AI pane Cmd+C copies, never the CLI's Ctrl+C", () => {
  expect(run(mac, ["editor", "global"], "\x1b[99;9u")).toBe("edit.copy")
  expect(run(mac, ["editor", "global"], "\x1b[120;9u")).toBe("edit.cut")
  expect(lookup(mac.ai, key("\x1b[99;9u"))).toBe("ai.copySelection")
  expect(lookup(mac.ai, "ctrl+c")).toBeUndefined()
})

test("Cmd works for Ctrl shortcuts off a Mac too (a Super key)", () => {
  expect(run(pc, ["editor", "global"], "\x1b[115;9u")).toBe("file.save")
})

test("Cmd+K starts the Ctrl+K chords", () => {
  const k = key("\x1b[107;9u")
  expect(k).toBe("cmd+k")
  expect(startsChord(mac.global, k)).toBe(true)
  expect(lookup(mac.global, `${k} s`)).toBe("file.saveAll")
  expect(lookup(mac.global, `${k} cmd+s`)).toBe("app.help")
})

test("Cmd+arrows and Cmd+Backspace stay text navigation", () => {
  for (const bytes of ["\x1b[1;9D", "\x1b[1;9C", "\x1b[1;9A", "\x1b[127;9u"]) {
    expect(cmdAsCtrl(key(bytes))).toBeNull()
    expect(run(mac, ["editor", "global"], bytes)).toBeUndefined()
  }
})

test("Option+←/→ and Option+Backspace reach the textarea on a Mac", () => {
  for (const bytes of ["\x1bb", "\x1bf", "\x1b[1;3D", "\x1b[1;3C", "\x1b\x7f"])
    expect(run(mac, ["editor", "global"], bytes)).toBeUndefined()
  expect(run(mac, ["editor"], "\x1bB")).toBe("git.toggleFileBlame")
  expect(run(mac, ["global"], "\x1b[1;7D")).toBe("nav.back")
})

test("Ghostty's Ctrl+A / Ctrl+E for Cmd+←/→ go to the line ends in the editor", () => {
  expect(run(mac, ["editor", "global"], "\x01")).toBe("edit.lineStart")
  expect(run(mac, ["editor", "global"], "\x05")).toBe("edit.lineEnd")
  // From the tree or the AI pane Ctrl+E still comes back to the editor.
  expect(lookup(mac.global, key("\x05"))).toBe("focus.editor")
  expect(lookup(mac.ai, key("\x05"))).toBe("focus.editor")
})

test("PC keys are unchanged", () => {
  expect(run(pc, ["editor", "global"], "\x1b[1;3D")).toBe("nav.back")
  expect(run(pc, ["editor", "global"], "\x01")).toBe("edit.selectAll")
  expect(run(pc, ["editor"], "\x1bb")).toBe("git.toggleFileBlame")
})

test("user overrides win over the Mac defaults", () => {
  const b = buildBindings({ global: { "alt+left": "nav.back" }, editor: { "ctrl+a": "edit.selectAll" } }, { mac: true })
  expect(b.global.get("alt+left")).toBe("nav.back")
  expect(b.editor.get("ctrl+a")).toBe("edit.selectAll")
})

test("Cmd in config bindings", () => {
  expect(normalizeBinding("Cmd+Shift+P")).toBe("shift+cmd+p")
  expect(normalizeBinding("command+k command+c")).toBe("cmd+k cmd+c")
  expect(normalizeBinding("super+ctrl+x")).toBe("ctrl+cmd+x")
})

test("Mac labels", () => {
  expect(prettyKeys("shift+cmd+p", true)).toBe("⇧⌘P")
  expect(prettyKeys("ctrl+alt+left", true)).toBe("⌃⌥←")
  expect(prettyKeys("ctrl+k ctrl+c", true)).toBe("⌃K ⌃C")
  expect(keyText("Formatted (Ctrl+Z undoes), Ctrl+K E sends it", { mac: true, cmd: true })).toBe(
    "Formatted (⌘Z undoes), ⌘K E sends it",
  )
  expect(keyText("Formatted (Ctrl+Z undoes)", { mac: true, cmd: false })).toBe("Formatted (⌃Z undoes)")
  expect(keyText("Formatted (Ctrl+Z undoes)", { mac: false, cmd: true })).toBe("Formatted (Ctrl+Z undoes)")
})

test("palette shortcuts: ⌘ when the terminal sends Cmd, ⌃ otherwise", () => {
  const withCmd = commandKeys(mac, { mac: true, cmd: true })
  expect(withCmd.get("file.picker")).toBe("⌘P")
  expect(withCmd.get("edit.selectAll")).toBe("⌘A")
  expect(withCmd.get("buffer.goto1")).toBe("⌘1")
  expect(withCmd.get("edit.lineStart")).toBe("⌘←")
  const noCmd = commandKeys(mac, { mac: true, cmd: false })
  expect(noCmd.get("file.picker")).toBe("⌃P")
  expect(noCmd.get("buffer.goto1")).toBe("⌥1")
  expect(commandKeys(pc, { mac: false, cmd: true }).get("file.picker")).toBe("Ctrl+P")
})
