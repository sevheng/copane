import { afterEach, expect, test } from "bun:test"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function open(files: Record<string, string>) {
  const root = await fixture(files)
  const ws = createWorkspace(root)
  for (const name of Object.keys(files)) await ws.buffers.open(name)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return h
}

const text = (h: Harness) => h.ws.buffers.active!.textarea!.plainText

test("Ctrl+K is a chord prefix: Ctrl+K Ctrl+C comments, Ctrl+K Ctrl+U uncomments, Ctrl+K alone deletes nothing", async () => {
  const h = await open({ "a.ts": "const a = 1  \nconst b = 2\n" })
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(0, 0)
  await h.step(() => h.keys.pressKey("k", { ctrl: true }))
  expect(text(h)).toBe("const a = 1  \nconst b = 2\n")
  expect(h.frame()).toContain("Waiting for the second key")
  await h.step(() => h.keys.pressKey("c", { ctrl: true }))
  expect(text(h)).toBe("// const a = 1  \nconst b = 2\n")
  // The finished chord takes its "waiting" message down.
  expect(h.frame()).not.toContain("Waiting for the second key")
  // Adding again nests, as in VS Code; removing takes one level off.
  await h.step(() => h.keys.pressKey("k", { ctrl: true }))
  await h.step(() => h.keys.pressKey("u", { ctrl: true }))
  expect(text(h)).toBe("const a = 1  \nconst b = 2\n")
  await h.step(() => h.keys.pressKey("k", { ctrl: true }))
  await h.step(() => h.keys.pressKey("x", { ctrl: true }))
  expect(text(h)).toBe("const a = 1\nconst b = 2\n")
  // An unbound second key is reported and swallowed.
  await h.step(() => h.keys.pressKey("k", { ctrl: true }))
  await h.step(() => h.keys.pressKey("q"))
  expect(text(h)).toBe("const a = 1\nconst b = 2\n")
  expect(h.frame()).toContain("is not a command")
})

test("Alt+1..9 switch tabs; Ctrl+W then Ctrl+Alt+T reopens the closed tab", async () => {
  const h = await open({ "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" })
  await h.step(() => h.keys.pressKey("1", { meta: true }))
  expect(h.ws.buffers.active?.name).toBe("a.ts")
  await h.step(() => h.keys.pressKey("9", { meta: true }))
  expect(h.ws.buffers.active?.name).toBe("c.ts")
  await h.step(() => h.keys.pressKey("2", { meta: true }))
  expect(h.ws.buffers.active?.name).toBe("b.ts")
  await h.step(() => h.keys.pressKey("w", { ctrl: true }))
  expect(h.ws.buffers.list().map((b) => b.name)).toEqual(["a.ts", "c.ts"])
  await h.step(() => h.keys.pressKey("t", { ctrl: true, meta: true }))
  await Bun.sleep(50)
  expect(h.ws.buffers.active?.name).toBe("b.ts")
})

test("Alt+1 in a merge conflict still accepts the current side", async () => {
  const h = await open({ "a.ts": "x\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\ny\n" })
  const ta = h.ws.buffers.active!.textarea!
  await Bun.sleep(100)
  ta.setCursor(2, 0)
  await h.step(() => h.keys.pressKey("1", { meta: true }))
  expect(text(h)).toBe("x\nmine\ny\n")
})

test("Ctrl+Q works under a dialog: it closes it and asks about unsaved files; other global keys don't", async () => {
  const h = await open({ "a.ts": "a\n" })
  h.ws.buffers.active!.textarea!.insertText("x")
  h.ws.buffers.onContentChange(h.ws.buffers.active!.id)
  await h.step(() => h.ws.ui.set({ modal: { kind: "recent" } }))
  await h.step(() => h.keys.pressKey("w", { ctrl: true }))
  expect(h.ws.buffers.list()).toHaveLength(1)
  await h.step(() => h.keys.pressKey("q", { ctrl: true }))
  await h.step(() => {})
  expect(h.frame()).toContain("Unsaved changes")
})
