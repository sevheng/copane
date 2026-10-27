import { useEffect, useState, useSyncExternalStore } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { HoverBox } from "../app/Modal"
import { useUi, useWorkspace } from "../app/workspace"
import { diffColors, ui as colors } from "../config/theme"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { hunkPatch } from "../editor/hunks"
import { useSyntaxStyle } from "../editor/syntaxStyle"
import { acceptAiChangeAt, aiHunkContext, gotoAiChange, undoAiChangeAt, type AiHunkContext } from "../ai/review"
import { gotoChange, hunkContext, revertHunkAt, stageHunk, type HunkContext } from "./hunkActions"

const MAX_LINES = 12
const noSubscribe = () => () => {}

/**
 * Inline view of one change under its lines: what was removed (red) and added (green).
 * A git change has Stage / Revert (s, r); an unreviewed AI edit has Accept / Undo (a, r), and
 * accepting moves on to the next one. Both: ↑ ↓ step, Esc closes, other keys close it.
 */
export function HunkPeek() {
  const ws = useWorkspace()
  const ui = useUi()
  const dims = useTerminalDimensions()
  const syntaxStyle = useSyntaxStyle()
  const peek = ui.hunkPeek
  const ai = peek?.kind === "ai"
  const [ctx, setCtx] = useState<HunkContext | AiHunkContext | null>(null)
  const close = () => ws.ui.set({ hunkPeek: null })
  const reviewVersion = useSyncExternalStore(ws.review?.store.subscribe ?? noSubscribe, () => ws.review?.store.get().version ?? 0)

  useEffect(() => {
    let live = true
    if (!peek) return setCtx(null)
    const load = ai ? Promise.resolve(aiHunkContext(ws, peek.row)) : hunkContext(ws, peek.row)
    void load.then((c) => {
      if (!live) return
      if (c) return setCtx(c)
      // An AI change can go away under the peek (accepted, edited): just close.
      if (!ai) ws.notify("No change on this line")
      if (ws.ui.get().hunkPeek === peek) ws.ui.set({ hunkPeek: null })
    })
    return () => {
      live = false
    }
  }, [ws, peek?.bufId, peek?.row, ai, ai ? reviewVersion : 0])

  // Close when the buffer changes, focus moves, or a dialog opens.
  useEffect(() => {
    if (peek && (ws.buffers.active?.id !== peek.bufId || ui.focus !== "editor" || ui.modal)) close()
  })

  const stage = async () => {
    if (!peek) return
    const err = await stageHunk(ws, peek.row)
    ws.notify(err ?? "Staged this change", err ? "error" : "info")
    close()
  }
  const revert = async () => {
    if (!peek) return
    const err = await revertHunkAt(ws, peek.row)
    ws.notify(err ?? "Reverted this change (Ctrl+Z undoes)", err ? "error" : "info")
    close()
  }
  const step = async (dir: 1 | -1) => {
    if (ai) {
      const at = await gotoAiChange(ws, dir)
      ws.ui.set({ hunkPeek: at ? { ...at, kind: "ai" } : null })
      return
    }
    const row = await gotoChange(ws, dir)
    if (row !== null) ws.ui.set({ hunkPeek: { bufId: ws.buffers.active!.id, row } })
  }
  const accept = async () => {
    if (!peek) return
    const err = acceptAiChangeAt(ws, peek.row)
    if (err) return ws.notify(err, "error")
    // On to the next one, so a review is a run of a's.
    const at = await gotoAiChange(ws, 1, true)
    if (at) return ws.ui.set({ hunkPeek: { ...at, kind: "ai" } })
    close()
    ws.notify("All AI changes reviewed")
  }
  const undo = () => {
    if (!peek) return
    const err = undoAiChangeAt(ws, peek.row)
    ws.notify(err ?? "Undid this AI change (Ctrl+Z brings it back)", err ? "error" : "info")
    close()
  }

  useKeyboard((key) => {
    if (!peek || ui.modal) return
    const keys = ai ? ["a", "r", "up", "down", "escape"] : ["s", "r", "up", "down", "escape"]
    const handled = keys.includes(key.name) && !key.ctrl && !key.meta
    if (!handled) return close() // let the key reach the editor
    key.preventDefault()
    key.stopPropagation()
    if (ai && key.name === "a") void accept()
    else if (ai && key.name === "r") undo()
    else if (key.name === "s") void stage()
    else if (key.name === "r") void revert()
    else if (key.name === "down") void step(1)
    else if (key.name === "up") void step(-1)
    else close()
  })

  const ed = ws.buffers.active?.textarea as CodeEditorRenderable | null | undefined
  if (!peek || !ctx || !ed) return null
  const h = ctx.hunk
  const total = h.removed.length + h.added.length
  // The first MAX_LINES lines: removed ones first, as the diff shows them.
  const removed = h.removed.slice(0, MAX_LINES)
  const added = h.added.slice(0, MAX_LINES - removed.length)
  const shown = { ...h, removed, added, oldLines: removed.length, newLines: added.length }
  const buf = ws.buffers.active!
  const lastRow = h.newStart + Math.max(1, h.newLines) - 1
  const anchor = ed.rowScreenY(Math.min(lastRow, ed.lineCount - 1)) ?? ed.y
  // Top and bottom border, the header row, the lines, and the "more" note.
  const height = removed.length + added.length + 3 + (total > MAX_LINES ? 1 : 0)
  const below = anchor + 1 + height <= dims.height - 1
  const top = below ? anchor + 1 : Math.max(0, anchor - height - Math.max(0, h.newLines - 1))
  const idx = ctx.all.indexOf(h) + 1
  const btn = (label: string, run: () => void) => (
    <HoverBox onPress={run} paddingX={1} bg={colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {label}
      </text>
    </HoverBox>
  )
  return (
    <box
      position="absolute"
      left={ed.x}
      top={top}
      width={ed.width}
      height={height}
      zIndex={130}
      backgroundColor={colors.panelBg}
      border={["top", "bottom"]}
      borderColor={ai ? colors.aiEdit : colors.accent}
      flexDirection="column"
    >
      <box flexDirection="row" height={1} gap={1} paddingLeft={1}>
        <text selectable={false} fg={colors.headerFg}>
          {ai ? "AI change" : "Change"} {idx} of {ctx.all.length}
        </text>
        <box flexGrow={1} />
        {ai ? btn("a Accept", () => void accept()) : btn("s Stage", () => void stage())}
        {ai ? btn("r Undo", undo) : btn("r Revert", () => void revert())}
        {btn("↑", () => void step(-1))}
        {btn("↓", () => void step(1))}
        {btn("Esc", close)}
      </box>
      <diff
        diff={hunkPatch(shown, buf.relPath)}
        view="unified"
        filetype={buf.filetype}
        syntaxStyle={syntaxStyle}
        wrapMode="none"
        {...diffColors}
      />
      {total > MAX_LINES ? (
        <text selectable={false} fg={colors.dim}>
          {` … ${total - MAX_LINES} more lines`}
        </text>
      ) : null}
    </box>
  )
}
