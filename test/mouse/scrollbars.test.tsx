import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { FileTree } from "../../src/files/FileTree"
import { TreeModel } from "../../src/files/TreeModel"
import type { CodeEditorRenderable } from "../../src/editor/CodeEditorRenderable"
import { createWorkspace, fixture, numbered, renderApp, waitUntil, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => h?.setup.renderer.destroy())
const until = (cond: () => boolean) => waitUntil(cond, 4000, () => h?.setup.renderOnce())
const THUMB = /[█▀▄▌▐]/

/** A 24-wide tree with 40 long-named files in src, and a 200-line a.txt whose line 6 is 128 columns (short files have no long line). */
async function app(opts: { files?: number; lines?: number; names?: string } = {}) {
  const files: Record<string, string> = {
    "a.txt": numbered(opts.lines ?? 200)
      .split("\n")
      .map((l, i) => (i === 5 && (opts.lines ?? 200) > 6 ? `${l} ${"x".repeat(120)}` : l))
      .join("\n"),
  }
  for (let i = 0; i < (opts.files ?? 40); i++)
    files[`src/${opts.names ?? "file-number-"}${i}${opts.names ? "" : "-with-a-long-name"}.ts`] = "x"
  const root = await fixture(files)
  const ws = createWorkspace(root, { treeWidth: 24 })
  const tree = new TreeModel(root)
  await ws.buffers.open("a.txt")
  h = await renderApp(ws, { tree: <FileTree tree={tree} height={24} icons="simple" /> }, { width: 100, height: 24 })
  await until(() => h!.frame().includes("src"))
  await tree.toggle(join(root, "src"))
  await until(() => h!.frame().includes(`${opts.names ?? "file-number-"}1`))
  await Bun.sleep(60)
  await h.setup.renderOnce()
  const ta = ws.buffers.active!.textarea as unknown as CodeEditorRenderable
  return { ws, tree, ta, root }
}
const drag = async (x: number, y: number, toX: number, toY: number) => {
  await h!.step(() => h!.mouse.pressDown(x, y))
  await h!.step(() => h!.mouse.moveTo(toX, toY))
  await h!.step(() => h!.mouse.release(toX, toY))
  await Bun.sleep(40)
  await h!.setup.renderOnce()
}
/** The column of cells x, rows 2..21 (the editor's text rows). */
const column = (x: number) =>
  h!
    .lines()
    .slice(2, 22)
    .map((l) => l[x] ?? " ")
    .join("")
/** The row under the editor's text that holds its horizontal bar, if any. */
const bottomBar = () => h!.lines().findIndex((l, i) => i > 2 && i < 23 && THUMB.test(l.slice(27, 95)))

test("the editor's scrollbars: a thumb on the right, one under the text; dragging scrolls, the cursor stays", async () => {
  const { ta } = await app()
  const vp = () => ta.editorView.getViewport()
  // 200 lines on 20 rows: a thumb at the right edge, near the top.
  expect(column(99)).toMatch(THUMB)
  // Line 6 is 128 columns wide, on screen: a bar under the text, starting after the line numbers.
  const bar = bottomBar()
  expect(bar).toBeGreaterThan(2)
  const row = h!.lines()[bar]!
  const thumbStart = row.slice(27).search(THUMB) + 27
  // Drag the bottom thumb right: the text scrolls sideways and stays there; the cursor keeps its place.
  await drag(thumbStart + 1, bar, thumbStart + 20, bar)
  expect(vp().offsetX).toBeGreaterThan(10)
  expect(h!.lines()[7]).not.toContain("line 6")
  expect(h!.lines()[7]).toContain("xxxx")
  expect(ta.logicalCursor).toMatchObject({ row: 0, col: 0 })
  expect(h!.frame()).toContain("Ln 1, Col 1")
  // The wheel (a tilt, or Shift+wheel) scrolls back; at the left edge the cursor is its own again.
  for (let i = 0; i < 60 && vp().offsetX > 0; i++) await h!.step(() => h!.mouse.scroll(50, 7, "left"))
  await until(() => vp().offsetX === 0)
  expect(ta.isParked).toBe(false)
  // Drag the right thumb down: the view scrolls, the cursor stays on line 1.
  const thumbY = 2 + column(99).search(THUMB)
  await drag(99, thumbY, 99, thumbY + 6)
  expect(vp().offsetY).toBeGreaterThan(20)
  expect(ta.logicalCursor.row).toBe(0)
  expect(h!.frame()).toContain("Ln 1, Col 1")
  // The long line is off screen now: nothing to scroll sideways to, so the bottom bar is gone.
  expect(bottomBar()).toBe(-1)
  // A click on the track jumps there.
  await h!.step(() => h!.mouse.click(99, 20))
  await until(() => vp().offsetY > 100)
})

test("a file that fits shows no scrollbars", async () => {
  await app({ lines: 5 })
  expect(column(99)).not.toMatch(THUMB)
  expect(bottomBar()).toBe(-1)
})

test("the tree's scrollbars: rows that don't fit get a thumb on the right, long names one along the bottom", async () => {
  await app()
  // 42 rows on ~21: a thumb in the tree's last column, below the header.
  const treeCol = () =>
    h!
      .lines()
      .slice(1, 23)
      .map((l) => l[23] ?? " ")
      .join("")
  expect(treeCol()).toMatch(THUMB)
  expect(h!.lines()[1]).toContain("src")
  // Drag it down: later rows show.
  const thumbY = 1 + treeCol().search(THUMB)
  await drag(23, thumbY, 23, thumbY + 10)
  expect(h!.lines()[1]).not.toContain("src")
  expect(h!.frame()).toContain("file-number-3")
  // Long names: a bar along the bottom row of the tree, from its left edge.
  const bottom = h!.lines().findIndex((l, i) => i > 1 && THUMB.test(l.slice(0, 23)))
  expect(bottom).toBeGreaterThan(1)
  const before = h!.lines()[2]
  await drag(2, bottom, 12, bottom)
  expect(h!.lines()[2]).not.toBe(before)
  expect(h!.lines()[2]).not.toMatch(/◆ file-number/)
})

test("a tree that fits shows no scrollbars", async () => {
  await app({ files: 3, names: "f" })
  const tree = h!
    .lines()
    .slice(1, 23)
    .map((l) => l.slice(0, 24))
    .join("\n")
  expect(tree).not.toMatch(THUMB)
})
