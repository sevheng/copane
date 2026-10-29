import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard } from "@opentui/react"
import type { BoxRenderable } from "@opentui/core"
import { dirname, sep } from "node:path"
import { useUi, useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { TreeModel } from "./TreeModel"
import type { GitMark, GitStatus } from "./gitStatus"
import { deleteItem, moveItem, newItem, openTreeMenu, renameItem, revealItem } from "./treeActions"
import { iconFor, type IconStyle } from "./icons"
import { PaneHeader } from "../app/PaneHeader"
import { DOUBLE_CLICK_MS, HoverBox } from "../app/Modal"
import { safely } from "../app/safely"
import { aiMarks, openAtFirstAiChange } from "../ai/review"
import "../app/Scrollbar"

const RIGHT = 2
/** Columns a wheel notch scrolls the tree sideways. */
const SIDE_STEP = 4
/** Columns kept for a row's mark (✎ ✦ M U •) at the right. */
const MARK_W = 3
const noGit = { subscribe: () => () => {}, getSnapshot: () => 0 }

function markColor(mark: GitMark | null): string | null {
  if (mark === "M") return colors.warn
  if (mark === "A" || mark === "U" || mark === "R") return colors.ok
  if (mark === "D" || mark === "!") return colors.error
  return null
}

export function FileTree({
  tree,
  height,
  git,
  icons = "none",
  header = true,
}: {
  tree: TreeModel
  height: number
  git?: Pick<GitStatus, "mark" | "dirMark" | "subscribe" | "getSnapshot">
  icons?: IconStyle
  /** Off inside the left pane, whose tab strip names it instead. */
  header?: boolean
}) {
  const ws = useWorkspace()
  const ui = useUi()
  useSyncExternalStore(tree.subscribe, tree.getSnapshot)
  useSyncExternalStore(git?.subscribe ?? noGit.subscribe, git?.getSnapshot ?? noGit.getSnapshot)
  // What the AI is editing now, and what it changed that you haven't reviewed.
  useSyncExternalStore(ws.review?.store.subscribe ?? noGit.subscribe, () => ws.review?.store.get() ?? 0)
  useSyncExternalStore(ws.turns?.store.subscribe ?? noGit.subscribe, () => ws.turns?.store.get() ?? 0)
  const ai = aiMarks(ws)
  const focused = ui.focus === "tree" && ui.sidebar === "files" && !ui.modal

  useEffect(() => {
    void tree.load()
  }, [tree])

  // Breadcrumb clicks ask the tree to reveal a folder.
  useEffect(() => {
    const p = ui.revealPath
    if (!p) return
    ws.ui.set({ revealPath: null })
    void tree.reveal(p).then(() => tree.expand(p))
  }, [ui.revealPath, tree, ws])

  const rows = tree.rows()
  const selectedIdx = Math.max(
    0,
    rows.findIndex((r) => r.entry.path === tree.selected),
  )
  // The rows' box: the pane less the header, and the horizontal scrollbar's row while it shows.
  const [rowsH, setRowsH] = useState(0)
  const viewH = Math.max(1, rowsH || height - (header ? 1 : 0))
  const maxTop = Math.max(0, rows.length - viewH)
  // Scroll offset is independent of the selection so the wheel can browse freely.
  const [topState, setTop] = useState(0)
  const top = Math.min(topState, maxTop)
  const [hovered, setHovered] = useState<string | null>(null)
  // The rows' width (less the vertical scrollbar while it shows): narrow trees indent less, and
  // long names scroll sideways instead of being cut with "…".
  const [width, setWidth] = useState(40)
  const indentW = width < 30 ? 1 : 2
  const [leftState, setLeft] = useState(0)

  /** Keep the keyboard selection on screen. */
  const reveal = (idx: number) => {
    if (idx < top) setTop(idx)
    else if (idx >= top + viewH) setTop(idx - viewH + 1)
  }
  // When something else selects a row (breadcrumbs, opening a file), scroll it into view.
  const lastSelected = useRef(tree.selected)
  useEffect(() => {
    if (tree.selected === lastSelected.current) return
    lastSelected.current = tree.selected
    if (selectedIdx < top || selectedIdx >= top + viewH) setTop(Math.max(0, selectedIdx - Math.floor(viewH / 3)))
    const row = rows[selectedIdx]
    if (row) showName(row)
  })

  const moveBy = (delta: number) => {
    const next = tree.move(delta)
    if (next) reveal(tree.rows().findIndex((r) => r.entry.path === next.entry.path))
    if (next) showName(next)
  }

  /** Open a row: a folder toggles; a file opens, and focus goes to it or (`focusEditor` false) stays here. */
  const openRow = async (idx: number, focusEditor = true) => {
    const row = rows[idx]
    if (!row) return
    tree.select(row.entry.path)
    if (row.entry.isDir) {
      ws.ui.set({ focus: "tree" })
      return tree.toggle(row.entry.path)
    }
    try {
      // A file with unreviewed AI changes, not open yet: straight to its first change.
      if (ws.review?.has(row.entry.path) && !ws.buffers.byPath(row.entry.path)) await openAtFirstAiChange(ws, row.entry.path)
      else await ws.buffers.open(row.entry.path)
      ws.ui.set({ focus: focusEditor ? "editor" : "tree" })
    } catch (err) {
      ws.notify((err as Error).message, "warn")
    }
  }

  // Mouse, as in VS Code's explorer: a click opens a file and keeps focus here (the keys still
  // work on the tree); a double-click moves to the editor. Opening waits for the release, since
  // a press may start a drag.
  const pressed = useRef<string | null>(null)
  const lastClick = useRef<{ path: string; at: number } | null>(null)
  const clickRow = (idx: number) => {
    const row = rows[idx]
    if (!row) return
    const now = Date.now()
    const double = !row.entry.isDir && lastClick.current?.path === row.entry.path && now - lastClick.current.at < DOUBLE_CLICK_MS
    // A third quick click stays in the editor too.
    lastClick.current = { path: row.entry.path, at: now }
    if (double) return ws.ui.set({ focus: "editor" })
    void openRow(idx, false)
  }

  // Drag and drop: a row dragged onto a folder (or a file in it, or empty space for the root) moves there.
  const boxRef = useRef<BoxRenderable | null>(null)
  const [drag, setDragState] = useState<{ from: string; to: string | null } | null>(null)
  // The handlers read it before React re-renders.
  const dragRef = useRef(drag)
  const setDrag = (d: typeof drag) => {
    dragRef.current = d
    setDragState(d)
  }
  /** The folder a drop at (x, y) goes into, or null where it can't go. */
  const dropDir = (from: string, x: number, y: number): string | null => {
    const b = boxRef.current
    if (!b || x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) return null
    const at = y - b.y - (header ? 1 : 0)
    if (at < 0) return null
    const r = rows[top + at]
    const dir = !r || at >= viewH ? tree.root : r.entry.isDir ? r.entry.path : dirname(r.entry.path)
    if (dir === from || dir.startsWith(from + sep) || dir === dirname(from)) return null
    return dir
  }

  useKeyboard((key) => {
    if (!focused) return
    const row = rows[selectedIdx]
    let handled = true
    // Shift+Alt+R, as in VS Code's explorer: show the selected row in the system file manager.
    if (key.meta && key.shift && key.name.toLowerCase() === "r" && !key.ctrl) {
      key.preventDefault()
      void revealItem(ws, row?.entry.path ?? ws.root, row ? row.entry.isDir : true)
      return
    }
    if (key.ctrl || key.meta) return
    switch (key.name) {
      case "a":
        void newItem(ws, tree, row ?? null, key.shift ? "folder" : "file")
        break
      case "r":
      case "f2":
        if (row) renameItem(ws, tree, row)
        break
      case "delete":
        if (row) void deleteItem(ws, tree, row)
        break
      case "up":
        moveBy(-1)
        break
      case "down":
        moveBy(1)
        break
      case "pageup":
        moveBy(-viewH)
        break
      case "pagedown":
        moveBy(viewH)
        break
      case "return":
        void openRow(selectedIdx)
        break
      // Space opens a file but stays in the tree (VS Code), so you can step through files.
      case "space":
        void openRow(selectedIdx, false)
        break
      case "right":
        if (row?.entry.isDir && !row.expanded) void tree.toggle(row.entry.path)
        else moveBy(1)
        break
      case "left":
        if (row?.entry.isDir && row.expanded) tree.collapse(row.entry.path)
        else if (row && row.depth > 0) {
          const parent = rows
            .slice(0, selectedIdx)
            .reverse()
            .find((r) => r.depth === row.depth - 1)
          if (parent) {
            tree.select(parent.entry.path)
            reveal(rows.indexOf(parent))
          }
        }
        break
      case "escape":
        ws.ui.set({ focus: "editor" })
        break
      default:
        handled = false
    }
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  const visible = rows.slice(top, top + viewH)
  const activePath = ws.buffers.active?.path

  // Sideways: the rows shift left together, as far as the longest one on screen needs.
  const avail = Math.max(1, width - 1 - MARK_W)
  const longest = Math.max(0, ...visible.map((r) => nameStart(r) + Bun.stringWidth(r.entry.name)))
  const maxLeft = Math.max(0, longest - avail)
  const left = Math.min(leftState, maxLeft)
  const track = { backgroundColor: colors.panelBg, foregroundColor: colors.scrollThumb }
  /** Scroll sideways just enough that a row's name shows (all of it when it fits, else its start). */
  function showName(r: (typeof rows)[number]) {
    const start = nameStart(r)
    const end = start + Bun.stringWidth(r.entry.name)
    setLeft((l) => (start < l ? start : end > l + avail ? Math.min(start, end - avail) : l))
  }
  /** Where a row's name begins: its indent, arrow and icon come first. */
  function nameStart(r: (typeof rows)[number]): number {
    const icon = iconFor(r.entry.name, r.entry.isDir, r.expanded, icons)
    const arrow = r.entry.isDir ? (icon ? 0 : 2) : icons === "none" ? 2 : 0
    return r.depth * indentW + arrow + (icon ? Bun.stringWidth(icon.glyph) + 1 : 0)
  }

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={colors.panelBg}
      overflow="hidden"
      ref={boxRef}
      onMouseDown={(e) => {
        ws.ui.set({ focus: "tree", sidebar: "files" })
        // Right-click on empty space: create at the project root.
        if (e.button === RIGHT) openTreeMenu(ws, tree, null, e.x, e.y)
      }}
      onMouseDrag={(e) => {
        const from = pressed.current
        if (!from || e.button !== 0) return
        e.stopPropagation()
        const b = boxRef.current
        if (b) {
          const at = e.y - b.y - (header ? 1 : 0)
          // A wobble within the pressed row is still a click, not a drag.
          if (!dragRef.current && rows[top + at]?.entry.path === from) return
          // Near the top or bottom edge: scroll, to drop on rows out of view.
          if (at <= 0 && top > 0) setTop(top - 1)
          else if (at >= viewH - 1 && top < maxTop) setTop(top + 1)
        }
        setDrag({ from, to: dropDir(from, e.x, e.y) })
      }}
      onMouseDragEnd={(e) => {
        const d = dragRef.current
        if (!d) return
        // The release that follows goes to the dragged row: not a click.
        pressed.current = null
        e.stopPropagation()
        setDrag(null)
        const to = dropDir(d.from, e.x, e.y)
        if (to) moveItem(ws, tree, d.from, to)
      }}
      onMouseScroll={(e) => {
        e.stopPropagation()
        const dir = e.scroll?.direction
        // Sideways: a tilt wheel or touchpad swipe, or Shift+wheel.
        const side =
          dir === "left" ? -1 : dir === "right" ? 1 : e.modifiers.shift ? (dir === "up" ? -1 : dir === "down" ? 1 : 0) : 0
        if (side) return setLeft(Math.max(0, Math.min(maxLeft, left + side * SIDE_STEP)))
        const d = dir === "up" ? -3 : dir === "down" ? 3 : 0
        setTop(Math.max(0, Math.min(maxTop, top + d)))
      }}
    >
      {header ? (
        <PaneHeader title="EXPLORER" focused={focused} bg={colors.panelBg}>
          <TreeToolbar tree={tree} />
        </PaneHeader>
      ) : null}
      <box flexGrow={1} flexDirection="row" overflow="hidden">
        <box
          flexGrow={1}
          flexDirection="column"
          overflow="hidden"
          onSizeChange={function (this: { width: number; height: number }) {
            setWidth(this.width)
            setRowsH(this.height)
          }}
        >
          {visible.map((r, i) => {
            const idx = top + i
            const isSel = idx === selectedIdx && tree.selected !== null
            const isHover = drag ? false : hovered === r.entry.path
            // While dragging: the folder the drop would go into, and what is in it.
            const isDrop = drag?.to != null && (r.entry.path === drag.to || dirname(r.entry.path) === drag.to)
            const icon = iconFor(r.entry.name, r.entry.isDir, r.expanded, icons)
            // A folder icon shows open/closed itself; the arrow is only for styles without one.
            const arrow = r.entry.isDir ? (icon ? "" : r.expanded ? "▾ " : "▸ ") : icons === "none" ? "  " : ""
            const isActive = r.entry.path === activePath
            const ignored = r.entry.ignored === true
            const fg = isActive ? colors.accent : ignored ? colors.ignoredFg : r.entry.isDir ? colors.text : colors.dim
            const mark = git ? (r.entry.isDir ? git.dirMark(r.entry.path) : git.mark(r.entry.path)) : null
            // The active file keeps its accent; git colours everything else.
            const gitColor = isActive ? null : markColor(mark)
            const aiMark = r.entry.isDir ? (ai.dir(r.entry.path) ? "•" : null) : ai.file(r.entry.path)
            return (
              <box
                key={r.entry.path}
                height={1}
                flexDirection="row"
                paddingLeft={1}
                backgroundColor={
                  isDrop
                    ? colors.selectionBg
                    : isSel
                      ? focused
                        ? colors.selectionBg
                        : colors.tabActiveBg
                      : isHover
                        ? colors.tabActiveBg
                        : undefined
                }
                onMouseOver={() => setHovered(r.entry.path)}
                onMouseOut={() => setHovered((h) => (h === r.entry.path ? null : h))}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  pressed.current = null
                  if (e.button === RIGHT) {
                    tree.select(r.entry.path)
                    ws.ui.set({ focus: "tree" })
                    openTreeMenu(ws, tree, r, e.x, e.y)
                  } else if (e.button === 0) {
                    tree.select(r.entry.path)
                    ws.ui.set({ focus: "tree", sidebar: "files" })
                    pressed.current = r.entry.path
                  }
                }}
                onMouseUp={(e) => {
                  // A release after a drag is the drop, not a click (drag-end already cleared `pressed`).
                  if (e.button !== 0 || pressed.current !== r.entry.path) return
                  pressed.current = null
                  e.stopPropagation()
                  clickRow(idx)
                }}
              >
                <box flexGrow={1} flexShrink={1} overflow="hidden">
                  {/* One line, clipped at the pane's edge (no "…"); scrolled sideways by `left`. */}
                  <text
                    selectable={false}
                    wrapMode="none"
                    flexShrink={0}
                    marginLeft={-left}
                    fg={isSel && focused ? colors.text : (gitColor ?? fg)}
                  >
                    {" ".repeat(r.depth * indentW)}
                    {arrow}
                    {icon ? <span fg={ignored ? colors.ignoredFg : icon.color}>{icon.glyph} </span> : null}
                    {r.entry.name}
                  </text>
                </box>
                {/* A blank cell after the mark: glyphs like ✎ draw wider than their cell, and the
                pane's edge would cut them. */}
                {aiMark ? (
                  <box width={3} flexShrink={0}>
                    <text selectable={false} fg={colors.aiEdit}>
                      {` ${aiMark} `}
                    </text>
                  </box>
                ) : mark ? (
                  <box width={3} flexShrink={0}>
                    <text selectable={false} fg={gitColor ?? colors.dim}>
                      {r.entry.isDir ? " • " : ` ${mark} `}
                    </text>
                  </box>
                ) : null}
              </box>
            )
          })}
        </box>
        {/* Scrollbars, hidden while everything fits; their thumbs drag (Windows Terminal sends no sideways wheel). */}
        <scrollbar
          orientation="vertical"
          width={1}
          flexShrink={0}
          scrollSize={rows.length}
          viewportSize={viewH}
          scrollPosition={top}
          trackOptions={track}
          onChange={setTop}
        />
      </box>
      <scrollbar
        orientation="horizontal"
        height={1}
        flexShrink={0}
        scrollSize={longest}
        viewportSize={avail}
        scrollPosition={left}
        trackOptions={track}
        onChange={setLeft}
      />
    </box>
  )
}

/** Nerd Font codicons, as in VS Code's EXPLORER header; plain glyphs otherwise. */
const TOOL_GLYPHS = {
  nerd: { file: "\u{ea7f}", folder: "\u{ea80}", refresh: "\u{eb37}", collapse: "\u{eac5}" },
  plain: { file: "+", folder: "+/", refresh: "\u21bb", collapse: "\u229f" },
}

/** New File, New Folder, Refresh and Collapse All buttons for the tree, acting on its selection. */
export function TreeToolbar({ tree }: { tree: TreeModel }) {
  const ws = useWorkspace()
  const g = ws.config.tree.icons === "nerd" ? TOOL_GLYPHS.nerd : TOOL_GLYPHS.plain
  const selected = () => tree.rows().find((r) => r.entry.path === tree.selected) ?? null
  const button = (glyph: string, run: () => unknown) => (
    <HoverBox paddingX={1} onPress={(b) => b === 0 && void safely(ws, run)}>
      <text selectable={false} fg={colors.headerFg}>
        {glyph}
      </text>
    </HoverBox>
  )
  return (
    <box flexDirection="row" flexShrink={1} overflow="hidden">
      {button(g.file, () => newItem(ws, tree, selected(), "file"))}
      {button(g.folder, () => newItem(ws, tree, selected(), "folder"))}
      {button(g.refresh, () => tree.refreshAll())}
      {button(g.collapse, () => tree.collapseAll())}
    </box>
  )
}
