import { afterEach, expect, test } from "bun:test"
import { createWorkspace, fixture, numbered, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function open(lines = 80) {
  const root = await fixture({ "a.txt": numbered(lines) })
  const ws = createWorkspace(root)
  await ws.buffers.open("a.txt")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return h
}

const status = (h: Harness) =>
  h
    .lines()
    .at(-2)!
    .match(/Ln \d+, Col \d+/)?.[0]

test("clicking in the editor moves the cursor and updates the status bar", async () => {
  const h = await open()
  const p = h.find("line 5")
  await h.step(() => h.mouse.click(p.x + 3, p.y))
  expect(status(h)).toBe("Ln 5, Col 4")
})

test("drag-selecting updates the status bar to the drag end", async () => {
  const h = await open()
  const a = h.find("line 2")
  await h.step(() => h.mouse.drag(a.x, a.y, a.x + 4, a.y + 2))
  expect(h.ws.buffers.active!.textarea!.getSelectedText()).toBe("line 2\nline 3\nline")
  expect(status(h)).toBe("Ln 4, Col 5")
})

test("the wheel scrolls the view without moving the cursor", async () => {
  const h = await open()
  const p = h.find("line 1")
  await h.step(() => h.mouse.click(p.x, p.y))
  for (let i = 0; i < 4; i++) await h.step(() => h.mouse.scroll(p.x, p.y + 3, "down"))
  const ta = h.ws.buffers.active!.textarea!
  expect(ta.scrollY).toBeGreaterThan(0)
  expect(ta.logicalCursor.row).toBe(0)
  expect(h.frame()).not.toContain("│ 1 line 1 ")
  expect(status(h)).toBe("Ln 1, Col 1")
})

test("the wheel scrolls right after opening a file, before any click", async () => {
  const h = await open()
  const p = h.find("line 1")
  await h.step(() => h.mouse.scroll(p.x, p.y + 3, "down"))
  await Bun.sleep(50)
  await h.step(() => {})
  expect(h.ws.buffers.active!.textarea!.scrollY).toBe(1)
})

test("the wheel still scrolls after typing, and the cursor stays where it was", async () => {
  const h = await open()
  const p = h.find("line 4")
  await h.step(() => h.mouse.click(p.x + 6, p.y))
  await h.step(() => h.keys.typeText("k"))
  await h.step(() => h.keys.pressArrow("down"))
  for (let i = 0; i < 3; i++) await h.step(() => h.mouse.scroll(p.x, p.y, "down"))
  await Bun.sleep(50)
  await h.step(() => {})
  const ta = h.ws.buffers.active!.textarea!
  expect(ta.scrollY).toBe(3)
  expect(ta.logicalCursor).toMatchObject({ row: 4, col: 6 })
  expect(ta.hasSelection()).toBe(false)
  await h.step(() => h.keys.typeText("Z"))
  expect(ta.plainText.split("\n")[4]).toBe("line 5Z")
  expect(status(h)).toBe("Ln 5, Col 8")
})

test("a click after scrolling far away places the cursor where clicked", async () => {
  const h = await open()
  const p = h.find("line 1")
  for (let i = 0; i < 30; i++) await h.step(() => h.mouse.scroll(p.x, p.y + 3, "down"))
  expect(status(h)).toBe("Ln 1, Col 1")
  const q = h.find("line 40")
  await h.step(() => h.mouse.click(q.x + 2, q.y))
  await h.step(() => h.keys.typeText("Q"))
  expect(h.ws.buffers.active!.textarea!.plainText.split("\n")[39]).toBe("liQne 40")
})

test("typing after scrolling away brings the cursor back into view", async () => {
  const h = await open()
  const p = h.find("line 1")
  for (let i = 0; i < 10; i++) await h.step(() => h.mouse.scroll(p.x, p.y + 3, "down"))
  await h.step(() => h.keys.typeText("Z"))
  expect(h.frame()).toContain("Zline 1")
})

test("clicking the editor while the tree has focus moves keyboard focus to the editor", async () => {
  const h = await open()
  h.ws.ui.set({ focus: "tree" })
  const p = h.find("line 3")
  await h.step(() => h.mouse.click(p.x, p.y))
  expect(h.ws.ui.get().focus).toBe("editor")
  await h.step(() => h.keys.typeText("Q"))
  expect(h.frame()).toContain("Qline 3")
})

test("change markers: lines differing from the index get a sign; reloads flash", async () => {
  const root = await fixture({ "a.txt": "one\ntwo\nthree\n" })
  const ws = createWorkspace(root)
  const listeners = new Set<() => void>()
  ws.git = {
    indexText: async () => "one\nTWO\nthree\n",
    for: () => null,
    current: () => null,
    list: () => [],
    main: { enabled: false },
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
  } as never
  await ws.buffers.open("a.txt")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await Bun.sleep(250)
  await h.setup.renderOnce()
  const row = (n: string) => h!.lines().find((l) => l.includes(n))!
  expect(row("two")).toContain("2▎")
  expect(row("one")).not.toContain("▎")
  // Typing on line 1 marks it too.
  await h.step(() => h!.keys.typeText("x"))
  await Bun.sleep(250)
  await h.setup.renderOnce()
  expect(row("xone")).toContain("1▎")
})

test("word wrap (Alt+Z): long lines wrap, clicks and line numbers map to the right line", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ") // ~150 columns
  const root = await fixture({ "a.txt": `first\n${long}\nlast\n` })
  const ws = createWorkspace(root)
  await ws.buffers.open("a.txt")
  h = await renderApp(ws, { tree: <text>TREE</text> }, { width: 80, height: 20 })
  await h.step(() => h!.keys.pressKey("z", { meta: true }))
  await Bun.sleep(30)
  await h.setup.renderOnce()
  expect(ws.ui.get().wordWrap).toBe(true)
  const last = h.find("last")
  // "last" is pushed down by the wrapped line; its number is still 3.
  expect(h.lines()[last.y]).toContain("3 last")
  expect(last.y).toBeGreaterThan(h.find("first").y + 2)
  // Click the second visual row of line 2: the cursor lands on line 2, past the first row.
  const firstRow = h.find("w0 ")
  await h.step(() => h!.mouse.click(firstRow.x + 2, firstRow.y + 1))
  const ta = ws.buffers.active!.textarea!
  expect(ta.logicalCursor.row).toBe(1)
  expect(ta.logicalCursor.col).toBeGreaterThan(20)
  // Toggle back (the cursor first to the line's start: unwrapped, the view would scroll sideways to it).
  ta.setCursor(1, 0)
  await h.step(() => h!.keys.pressKey("z", { meta: true }))
  await Bun.sleep(30)
  await h.setup.renderOnce()
  expect(h.lines()[h.find("last").y]).toContain("3 last")
  expect(h.find("last").y).toBe(h.find("first").y + 2)
})

test("line numbers keep all digits past line 99 (and past 999)", async () => {
  const h = await open(1200)
  const ta = h.ws.buffers.active!.textarea!
  ta.setCursor(150, 0)
  ;(ta as unknown as { revealLine: (r: number) => void }).revealLine(150)
  await Bun.sleep(80)
  await h.setup.renderOnce()
  const row = h.lines().find((l) => l.includes("line 151"))!
  expect(row).toContain("151 line 151")
  ;(ta as unknown as { goTo: (r: number, c: number) => void }).goTo(1100, 0)
  await Bun.sleep(30)
  await h.setup.renderOnce()
  expect(h.lines().find((l) => l.includes("line 1101"))).toContain("1101 line 1101")
  // The last line's own number is unchanged.
  ;(ta as unknown as { goTo: (r: number, c: number) => void }).goTo(1199, 0)
  await Bun.sleep(30)
  await h.setup.renderOnce()
  expect(h.lines().find((l) => l.includes("line 1200"))).toContain("1200 line 1200")
})
