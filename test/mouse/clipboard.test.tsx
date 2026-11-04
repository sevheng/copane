import { afterEach, expect, test } from "bun:test"
import { MouseButtons } from "@opentui/core/testing"
import type { Clipboard } from "../../src/app/clipboard"
import { configSchema } from "../../src/config/schema"
import { TerminalPane } from "../../src/ai/TerminalPane"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

let h: Harness | null = null
afterEach(async () => {
  h?.ws.ai?.kill()
  h?.setup.renderer.destroy()
  h = null
  await Bun.sleep(20)
})

function fakeClipboard(initial: string | null = null) {
  const state = { copied: [] as string[], value: initial }
  const cb: Clipboard = {
    tool: null,
    copy: async (t) => {
      state.copied.push(t)
      state.value = t
      return "system"
    },
    paste: async () => state.value,
  }
  return { cb, state }
}

async function editorApp(text: string, opts: { copyOnSelect?: boolean; clip?: string | null } = {}) {
  const root = await fixture({ "a.txt": text })
  const { cb, state } = fakeClipboard(opts.clip ?? null)
  const config = configSchema.parse({ editor: { copyOnSelect: !!opts.copyOnSelect } })
  const ws = createWorkspace(root, undefined, config, cb)
  await ws.buffers.open("a.txt")
  h = await renderApp(ws, {})
  return { h, ws, state, ta: () => ws.buffers.active!.textarea! }
}

test("Ctrl+C copies the selection, or the whole line without one", async () => {
  const { h, state } = await editorApp("alpha beta\ngamma\n")
  const a = h.find("alpha")
  await h.step(() => h.mouse.drag(a.x, a.y, a.x + 5, a.y))
  await h.step(() => h.keys.pressKey("c", { ctrl: true }))
  expect(state.copied.at(-1)).toBe("alpha")
  const g = h.find("gamma")
  await h.step(() => h.mouse.click(g.x + 2, g.y))
  await h.step(() => h.keys.pressKey("c", { ctrl: true }))
  expect(state.copied.at(-1)).toBe("gamma\n")
})

test("Ctrl+X cuts the line, Ctrl+V pastes over a selection", async () => {
  const { h, state, ta } = await editorApp("one\ntwo\nthree\n")
  const t = h.find("two")
  await h.step(() => h.mouse.click(t.x, t.y))
  await h.step(() => h.keys.pressKey("x", { ctrl: true }))
  expect(state.copied.at(-1)).toBe("two\n")
  expect(ta().plainText).toBe("one\nthree\n")
  const th = h.find("three")
  await h.step(() => h.mouse.drag(th.x, th.y, th.x + 5, th.y))
  await h.step(() => h.keys.pressKey("v", { ctrl: true }))
  await Bun.sleep(20)
  expect(ta().plainText).toBe("one\ntwo\n\n")
})

test("pasted control characters are stripped before insertion", async () => {
  const { h, ta } = await editorApp("x\n", { clip: "a\x1b[31mb\x07c" })
  await h.step(() => h.keys.pressKey("v", { ctrl: true }))
  await Bun.sleep(20)
  expect(ta().plainText).toBe("a[31mbcx\n")
})

test("right-click opens the menu at the pointer; outside the selection it moves the cursor first", async () => {
  const { h, ws, ta } = await editorApp("alpha beta\ngamma delta\n")
  const g = h.find("gamma")
  await h.step(() => h.mouse.click(g.x + 6, g.y, MouseButtons.RIGHT))
  expect(ta().logicalCursor).toMatchObject({ row: 1, col: 6 })
  expect(ws.ui.get().modal?.kind).toBe("menu")
  expect(h.find("Go to definition").y).toBe(g.y + 1)
  await h.step(() => h.mouse.click(0, 0))
  expect(ws.ui.get().modal).toBeNull()
})

test("right-click inside a selection keeps it, and menu Copy copies it", async () => {
  const { h, ws, state, ta } = await editorApp("alpha beta\n")
  const a = h.find("alpha")
  await h.step(() => h.mouse.drag(a.x, a.y, a.x + 5, a.y))
  await h.step(() => h.mouse.click(a.x + 2, a.y, MouseButtons.RIGHT))
  expect(ta().getSelectedText()).toBe("alpha")
  const copy = h.findAt("Copy", 0, a.y + 1)
  await h.step(() => h.mouse.click(copy.x, copy.y))
  await Bun.sleep(20)
  expect(state.copied.at(-1)).toBe("alpha")
  expect(ws.ui.get().modal).toBeNull()
})

test("menu works from the keyboard: arrows, Enter, Esc", async () => {
  const { h, ws, ta } = await editorApp("abc\n")
  const p = h.find("abc")
  await h.step(() => h.mouse.click(p.x, p.y, MouseButtons.RIGHT))
  await h.step(() => h.keys.pressArrow("down"))
  await h.step(() => h.keys.pressArrow("down"))
  await h.step(() => h.keys.pressArrow("down"))
  await h.step(() => h.keys.pressEnter())
  expect(ta().getSelectedText()).toBe("abc\n")
  await h.step(() => h.mouse.click(p.x, p.y, MouseButtons.RIGHT))
  // A lone Esc is only recognised after the escape-sequence timeout.
  await h.step(async () => {
    h.keys.pressEscape()
    await Bun.sleep(150)
  })
  expect(ws.ui.get().modal).toBeNull()
})

test("copyOnSelect copies when the drag ends", async () => {
  const { h, state } = await editorApp("hello world\n", { copyOnSelect: true })
  const p = h.find("hello")
  await h.step(() => h.mouse.drag(p.x, p.y, p.x + 5, p.y))
  await Bun.sleep(20)
  expect(state.copied).toEqual(["hello"])
})

test("AI pane: a mouse selection is copied on release", async () => {
  const root = await fixture({})
  const { cb, state } = fakeClipboard()
  const ws = createWorkspace(root, { focus: "ai" }, undefined, cb)
  const hh = await renderApp(ws, {
    ai: <TerminalPane config={{ command: "/bin/sh", args: ["-c", "echo PICKME; sleep 5"], maxScrollbackBytes: 10000 }} />,
  })
  h = hh
  for (let i = 0; i < 40 && !hh.frame().includes("PICKME"); i++) {
    await Bun.sleep(25)
    await hh.setup.renderOnce()
  }
  const p = hh.find("PICKME")
  await hh.step(() => hh.mouse.drag(p.x, p.y, p.x + 6, p.y))
  await Bun.sleep(20)
  expect(state.copied.at(-1)).toBe("PICKME")
})

test("AI pane on a Mac: Cmd+C copies the selection and never interrupts the CLI", async () => {
  const root = await fixture({})
  const { cb, state } = fakeClipboard()
  const ws = createWorkspace(root, { focus: "ai" }, configSchema.parse({ keyStyle: "mac" }), cb)
  // Ctrl+C reaching the shell would print INTERRUPTED.
  const script = "trap 'echo INTERRUPTED' INT; echo PICKME; while :; do sleep 0.05; done"
  const hh = await renderApp(ws, {
    ai: <TerminalPane config={{ command: "/bin/sh", args: ["-c", script], maxScrollbackBytes: 10000 }} />,
  })
  h = hh
  await waitUntil(
    () => hh.frame().includes("PICKME"),
    3000,
    () => hh.setup.renderOnce(),
  )
  // Nothing selected: a notice, nothing copied.
  await hh.step(() => hh.keys.pressKey("\x1b[99;9u"))
  expect(hh.frame()).toContain("Nothing selected")
  expect(state.copied).toEqual([])
  const p = hh.find("PICKME")
  await hh.step(() => hh.mouse.drag(p.x, p.y, p.x + 6, p.y))
  await waitUntil(
    () => state.copied.length === 1,
    3000,
    () => hh.setup.renderOnce(),
  )
  // Cmd+C as a kitty-protocol terminal sends it.
  await hh.step(() => hh.keys.pressKey("\x1b[99;9u"))
  await waitUntil(
    () => state.copied.length === 2,
    3000,
    () => hh.setup.renderOnce(),
  )
  expect(state.copied).toEqual(["PICKME", "PICKME"])
  // A real Ctrl+C still goes to the CLI: proof the trap would have shown one.
  await hh.step(() => hh.keys.pressKey("c", { ctrl: true }))
  await waitUntil(
    () => hh.frame().includes("INTERRUPTED"),
    3000,
    () => hh.setup.renderOnce(),
  )
  expect(hh.frame().match(/INTERRUPTED/g)?.length).toBe(1)
})

test("clicking interface labels (tabs, status bar) keeps the editor selection", async () => {
  const { h, ta } = await editorApp("alpha beta\n")
  const a = h.find("alpha")
  await h.step(() => h.mouse.drag(a.x, a.y, a.x + 5, a.y))
  const tab = h.findAt("a.txt", 0, 0)
  await h.step(() => h.mouse.click(tab.x + 1, tab.y))
  const hint = h.find("^P files")
  await h.step(() => h.mouse.click(hint.x + 1, hint.y))
  await h.step(async () => {
    h.keys.pressEscape()
    await Bun.sleep(150)
  })
  expect(ta().getSelectedText()).toBe("alpha")
})

test("AI pane: a click focuses it even when the CLI has mouse reporting on (like claude)", async () => {
  const root = await fixture({ "a.txt": "x\n" })
  const ws = createWorkspace(root, { focus: "editor" })
  await ws.buffers.open("a.txt")
  // Turn on SGR mouse reporting the way claude does, then print a marker.
  const script = "printf '\\033[?1000h\\033[?1002h\\033[?1006h'; echo MOUSEON; sleep 5"
  const hh = await renderApp(ws, {
    ai: <TerminalPane config={{ command: "/bin/sh", args: ["-c", script], maxScrollbackBytes: 10000 }} />,
  })
  h = hh
  for (let i = 0; i < 40 && !hh.frame().includes("MOUSEON"); i++) {
    await Bun.sleep(25)
    await hh.setup.renderOnce()
  }
  const p = hh.find("MOUSEON")
  await hh.step(() => hh.mouse.click(p.x + 2, p.y + 2))
  expect(ws.ui.get().focus).toBe("ai")
})

test("AI pane: a startup question (claude's trust prompt) pulls focus to the pane once", async () => {
  const root = await fixture({ "a.txt": "x\n" })
  const ws = createWorkspace(root, { focus: "tree" })
  const script =
    "printf 'Quick safety check: Is this a project you \\033[1mtrust\\033[0m?\\n Yes, I trust this\\n folder\\n'; sleep 5"
  const hh = await renderApp(ws, {
    ai: <TerminalPane config={{ command: "/bin/sh", args: ["-c", script], maxScrollbackBytes: 10000 }} />,
  })
  h = hh
  for (let i = 0; i < 40 && ws.ui.get().focus !== "ai"; i++) {
    await Bun.sleep(25)
    await hh.setup.renderOnce()
  }
  expect(ws.ui.get().focus).toBe("ai")
  expect(ws.ui.get().notice?.text).toContain("asking a question")
})

test("AI pane: the trust prompt while a dialog is open pulls focus once the dialog closes", async () => {
  const root = await fixture({ "a.txt": "x\n" })
  const ws = createWorkspace(root, { focus: "tree", modal: { kind: "help" } })
  const script = "printf 'Quick safety check: Is this a project you trust?\\n Yes, I trust this\\n folder\\n'; sleep 5"
  const hh = await renderApp(ws, {
    ai: <TerminalPane config={{ command: "/bin/sh", args: ["-c", script], maxScrollbackBytes: 10000 }} />,
  })
  h = hh
  for (let i = 0; i < 40 && !hh.frame().includes("Shortcuts"); i++) {
    await Bun.sleep(25)
    await hh.setup.renderOnce()
  }
  // The question has arrived (the scan runs within a second), but the dialog keeps the keyboard.
  await Bun.sleep(1200)
  await hh.setup.renderOnce()
  expect(ws.ui.get().focus).toBe("tree")
  await hh.step(() => hh.keys.pressEscape())
  for (let i = 0; i < 40 && ws.ui.get().focus !== "ai"; i++) {
    await Bun.sleep(25)
    await hh.setup.renderOnce()
  }
  expect(ws.ui.get().focus).toBe("ai")
  expect(ws.ui.get().notice?.text).toContain("asking a question")
})
