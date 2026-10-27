import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { configSchema } from "../../src/config/schema"
import { setCmdReachable } from "../../src/keymap/platform"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

setDefaultTimeout(15_000)

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function open(text: string) {
  const root = await fixture({ "a.ts": text })
  const ws = createWorkspace(root, {}, configSchema.parse({ keyStyle: "mac", editor: { startHidden: false } }))
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  ws.ui.set({ focus: "editor" })
  return h
}

const text = (h: Harness) => h.ws.buffers.active!.textarea!.plainText

test("Mac: Cmd+S saves, Ctrl+A / Ctrl+E (Cmd+←/→ in Ghostty) go to the line ends, Cmd+⌫ clears to the start", async () => {
  const h = await open("  hello world\n")
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(0, 8)
  await h.step(() => h.keys.pressKey("a", { ctrl: true }))
  expect(ta.logicalCursor).toMatchObject({ row: 0, col: 2 })
  await h.step(() => h.keys.pressKey("e", { ctrl: true }))
  expect(ta.logicalCursor).toMatchObject({ row: 0, col: 13 })
  expect(h.ws.ui.get().focus).toBe("editor")
  ta.setCursor(0, 8)
  await h.step(() => h.keys.pressBackspace({ super: true }))
  expect(text(h)).toBe("world\n")
  // Cmd+S as a kitty-protocol terminal sends it (the mock only sends Super on special keys).
  await h.step(() => h.keys.pressKey("\x1b[115;9u"))
  await waitUntil(
    () => !h.ws.buffers.active!.dirty,
    3000,
    () => h.setup.renderOnce(),
  )
  expect(await Bun.file(`${h.ws.root}/a.ts`).text()).toBe("world\n")
})

test("Mac: the palette shows ⌘ when the terminal sends Cmd, ⌃ when it doesn't", async () => {
  const h = await open("x\n")
  await h.step(() => h.ws.ui.set({ modal: { kind: "palette" } }))
  await h.step(() => h.keys.typeText("go to file"))
  expect(h.frame()).toContain("⌃P")
  await h.step(() => h.ws.ui.set({ modal: null }))
  setCmdReachable(true)
  await h.step(() => h.ws.ui.set({ modal: { kind: "palette" } }))
  await h.step(() => h.keys.typeText("go to file"))
  expect(h.frame()).toContain("⌘P")
})

test("Mac: Cmd+K Cmd+C is the Ctrl+K Ctrl+C chord", async () => {
  const h = await open("const a = 1\n")
  h.ws.buffers.active!.textarea!.setCursor(0, 0)
  // As a kitty-protocol terminal sends them.
  await h.step(() => h.keys.pressKey("\x1b[107;9u"))
  expect(h.frame()).toContain("Waiting for the second key")
  await h.step(() => h.keys.pressKey("\x1b[99;9u"))
  expect(text(h)).toBe("// const a = 1\n")
})
