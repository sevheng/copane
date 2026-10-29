import {
  Renderable,
  RGBA,
  TextareaRenderable,
  type KeyEvent,
  type LineInfo,
  type MouseEvent,
  type OptimizedBuffer,
  type RenderContext,
  type TextareaOptions,
} from "@opentui/core"
import { Glide } from "../app/glide"
import { SYNTAX_HL_REF } from "./highlighter"
import { combinedStyle, isOverlay } from "./syntaxStyle"

export interface LayerHighlight {
  line: number
  start: number
  end: number
  styleId: number
  priority?: number
}
import { extend } from "@opentui/react"
import { colToIndex, indexToCol } from "../lsp/positions"
import { indentUnit } from "./decorations"
import { indentString } from "./lineOps"
import { PAIRS, deletesPair, enterText, homeIndex, isTypingPairChar, typeChar } from "./typing"

/** Columns between a line's end and its note. */
const NOTE_GAP = 4

/** `s` cut to `cols` display columns, with "…" when cut. */
export function clipCols(s: string, cols: number): string {
  if (cols <= 0) return ""
  if (Bun.stringWidth(s) <= cols) return s
  let out = ""
  for (const ch of s) {
    if (Bun.stringWidth(out + ch) > cols - 1) break
    out += ch
  }
  return out + "…"
}

/** Lines drawn around the screen right after a jump, and added to each side per frame after. */
const SCREEN_MARGIN = 5
const GROW_STEP = 3

const LEFT = 0
const RIGHT = 2

/**
 * The native edit buffer's summary (OpenTUI 0.6): its size, and a counter every edit bumps.
 * Read without copying the text; not part of the public API, so used only when present.
 */
type EditInfo = { contentEpoch: bigint; byteLength: number }
type NativeEditBuffer = {
  lib?: { contextEditBufferGetInfo?(context: unknown, handle: unknown): EditInfo }
  native?: { handle: { context: unknown } }
}

/** One line of an editor's text; cheap for a CodeEditorRenderable, a full read otherwise. */
export function lineAt(ta: { plainText: string }, row: number): string {
  return ta instanceof CodeEditorRenderable ? ta.lineText(row) : (ta.plainText.split("\n")[row] ?? "")
}
type NativeHighlight = Parameters<TextareaRenderable["addHighlight"]>[1]
const layerHl = (h: LayerHighlight, ref: number): NativeHighlight => ({
  start: h.start,
  end: h.end,
  styleId: h.styleId,
  priority: h.priority,
  hlRef: ref,
})

const sameHighlights = (a: readonly LayerHighlight[] | undefined, b: readonly LayerHighlight[] | undefined): boolean => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.start !== y.start || x.end !== y.end || x.styleId !== y.styleId || x.priority !== y.priority) return false
  }
  return true
}

/** Lines whose highlights differ between two drawn states. */
function changedLines(old: Map<number, LayerHighlight[]>, next: Map<number, LayerHighlight[]>): number[] {
  const out: number[] = []
  for (const [line, list] of next) if (!sameHighlights(old.get(line), list)) out.push(line)
  for (const line of old.keys()) if (!next.has(line)) out.push(line)
  return out
}

type RawMouse = { type: string; button: number; x: number; y: number; modifiers: { ctrl: boolean } }
type MouseRouting = {
  processSingleMouseEvent(e: RawMouse): boolean
  hitTest(x: number, y: number): number
  clearSelection(): void
}
const routed = new WeakSet<object>()

/**
 * OpenTUI reads Ctrl+click as "extend the selection" whenever the renderer still holds one, which
 * it does after every plain click, and then never delivers the click. So a Ctrl+click on an
 * editor drops that selection first and reaches the editor as go to definition.
 */
function deliverCtrlClicks(ctx: RenderContext): void {
  if (routed.has(ctx)) return
  routed.add(ctx)
  const r = ctx as unknown as MouseRouting
  const process = r.processSingleMouseEvent
  if (typeof process !== "function") return
  r.processSingleMouseEvent = function (e) {
    if (e.type === "down" && e.button === LEFT && e.modifiers.ctrl) {
      const target = Renderable.renderablesByNumber.get(this.hitTest(e.x, e.y))
      if (target instanceof CodeEditorRenderable && target.onDefinitionClick) this.clearSelection()
    }
    return process.call(this, e)
  }
}

/**
 * The editor surface: a textarea with editor-style mouse behaviour.
 * - The wheel scrolls the view without losing the cursor (VS Code style). The native view
 *   insists on keeping its cursor on screen, so while scrolled away the real position is
 *   "parked": the native cursor rides along hidden, everything reading `logicalCursor` sees
 *   the parked one, and the next key or click puts it back (scrolling to it, as VS Code does).
 * - Every pointer interaction is reported so the app can sync the status bar and focus.
 * - Keys behave as in VS Code: Home/End work on the line (Ctrl for the file), PageUp/PageDown
 *   page, Enter keeps the indent, brackets and quotes close themselves.
 */
export interface ScrollState {
  x: number
  y: number
  width: number
  height: number
  /** Content columns (0 when lines wrap) and visual lines. */
  cols: number
  lines: number
}

export class CodeEditorRenderable extends TextareaRenderable {
  /** Called after any mouse interaction that may have moved the cursor or selection. */
  onPointer: ((event: MouseEvent) => void) | null = null
  /** Right-click handler; the cursor has already been placed. */
  onContextMenu: ((event: MouseEvent) => void) | null = null
  /** Undo or redo changed the text. The native buffer reports those only as a cursor move. */
  onHistory: (() => void) | null = null
  /** Ctrl+click (or Alt+click) on text: go to the definition at (row, col). */
  onDefinitionClick: ((row: number, col: number) => void) | null = null
  /** The view scrolled or its size changed (called after the frame that shows it). */
  onScroll: ((state: ScrollState) => void) | null = null
  private lastScroll = ""
  /** Enter keeps the line's indent (`editor.autoIndent`). */
  autoIndent = true
  /** Brackets and quotes close themselves (`editor.autoClosingBrackets`). */
  autoClosingBrackets = true
  private parked: { row: number; col: number } | null = null

  constructor(ctx: RenderContext, options: TextareaOptions) {
    super(ctx, options)
    deliverCtrlClicks(ctx)
  }

  /** The text's size in UTF-8 bytes, without reading it (constant time). */
  get byteSize(): number {
    return this.info()?.byteLength ?? new TextEncoder().encode(this.plainText).length
  }

  /** Text between two buffer offsets; `end` may run past the end of the text. */
  private textRange(start: number, end: number): string {
    // Native offsets are u32: "to the end" must not pass that.
    return start >= end ? "" : this.getTextRange(start, Math.min(end, 0xffff_ffff))
  }

  private info(): EditInfo | null {
    const eb = this.editBuffer as unknown as NativeEditBuffer
    const get = eb.lib?.contextEditBufferGetInfo
    return typeof get === "function" && eb.native ? get.call(eb.lib, eb.native.handle.context, eb.native.handle) : null
  }

  override undo(): boolean {
    const done = super.undo()
    this.onHistory?.()
    return done
  }

  override redo(): boolean {
    const done = super.redo()
    this.onHistory?.()
    return done
  }

  /**
   * Source lines for screen rows, read by the line-number gutter every frame. OpenTUI only reads
   * them for the whole file, so they are read once per text, width and wrap mode, then sliced.
   */
  getLineSources(startLine: number, lineCount: number): number[] {
    return this.visualLines().lineSources.slice(startLine, startLine + lineCount)
  }

  /** The whole file's visual lines (sources, widths), read once per text, width and wrap mode. */
  private visualLines(): LineInfo {
    const epoch = this.info()?.contentEpoch
    if (epoch === undefined) return this.lineInfo
    const key = `${epoch}:${this.width}:${this.wrapMode}`
    if (this.sources?.key !== key) this.sources = { key, info: this.lineInfo }
    return this.sources.info
  }
  private sources: { key: string; info: LineInfo } | null = null

  /** The source line of each screen row, top to bottom. */
  screenLineSources(): number[] {
    const vp = this.editorView.getViewport()
    return this.getLineSources(vp.offsetY, vp.height)
  }

  /**
   * Dimmed text after a line's end (the cursor line's blame, as in GitLens). Drawn only while the
   * cursor is on that line and nothing is selected, so a note that arrives late never sits on another line.
   */
  private note: { row: number; text: string; fg: RGBA } | null = null
  setLineNote(note: { row: number; text: string; fg: string } | null): void {
    const same = note && this.note && note.row === this.note.row && note.text === this.note.text
    if (same || (!note && !this.note)) return
    this.note = note ? { row: note.row, text: note.text, fg: RGBA.fromHex(note.fg) } : null
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)
    this.reportScroll()
    const n = this.note
    if (!n || this.logicalCursor.row !== n.row || this.hasSelection()) return
    const info = this.visualLines()
    // The line's last visual row (lineSources only grows): its end is where the note goes.
    let lo = 0
    let hi = info.lineSources.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (info.lineSources[mid]! <= n.row) lo = mid
      else hi = mid - 1
    }
    if (info.lineSources[lo] !== n.row) return
    const vp = this.editorView.getViewport()
    const y = lo - vp.offsetY
    const x = (info.lineWidthCols[lo] ?? 0) - vp.offsetX + NOTE_GAP
    if (y < 0 || y >= vp.height || x < 0) return
    const text = clipCols(n.text, this.width - x)
    if (text.length >= 8) buffer.drawText(text, this.x + x, this.y + y, n.fg)
  }

  /**
   * Highlight layers (syntax colours, indent guides): stored for the whole file, but only the
   * lines around the viewport are handed to the native buffer. Adding tens of thousands of
   * highlights per edit made big files lag for seconds.
   */
  private layers = new Map<number, Map<number, LayerHighlight[]>>()
  /** The lines drawn now, and the window they are growing to (after a jump or scroll). */
  private window: { from: number; to: number } | null = null
  private target: { from: number; to: number } | null = null

  setHighlightLayer(ref: number, highlights: readonly LayerHighlight[]): void {
    const byLine = new Map<number, LayerHighlight[]>()
    for (const h of highlights) {
      const list = byLine.get(h.line)
      if (list) list.push(h)
      else byLine.set(h.line, [h])
    }
    this.layers.set(ref, byLine)
    this.window ??= this.windowAround()
    this.drawLayer(ref, this.window)
    this.requestRender()
  }

  clearHighlightLayer(ref: number): void {
    this.layers.delete(ref)
    this.removeHighlightsByRef(ref)
  }

  /** The logical lines on screen, plus `margin` screens either side. */
  visibleLines(margin = 0): { from: number; to: number } {
    const vp = this.editorView.getViewport()
    const top = this.wraps ? this.lineAtScreenY(this.y) : vp.offsetY
    return { from: Math.max(0, top - vp.height * margin), to: top + vp.height * (1 + margin) }
  }

  /** Lines worth highlighting: the viewport plus two screens either side (adding highlights is slow natively). */
  private windowAround(): { from: number; to: number } {
    const vp = this.editorView.getViewport()
    const top = this.wraps ? this.lineAtScreenY(this.y) : vp.offsetY
    const margin = Math.max(60, vp.height * 2)
    return { from: Math.max(0, top - margin), to: top + vp.height + margin }
  }

  /**
   * What the native buffer holds, mirrored here so a layer update can redraw only the lines that
   * changed: typing re-highlights the whole file, but usually only the edited line differs.
   * `drawn` is per layer, `direct` is everything added with plain addHighlight (diagnostics,
   * find matches...). Native highlights stay on their line index through edits, so this mirror
   * stays true until a clear.
   */
  private drawn = new Map<number, Map<number, LayerHighlight[]>>()
  private direct = new Map<number, NativeHighlight[]>()

  override addHighlight(line: number, hl: NativeHighlight): void {
    const list = this.direct.get(line)
    if (list) list.push(hl)
    else this.direct.set(line, [hl])
    this.nativeAdd(line, hl)
  }

  /**
   * Hand one highlight to the native buffer. It shows one highlight per cell, so an overlay (the
   * word under the cursor, a find match) would hide the syntax colour under it: it is cut where
   * the colours change, and each piece gets the overlay's background with the colour below.
   */
  private nativeAdd(line: number, hl: NativeHighlight): void {
    const syntax = hl.hlRef === SYNTAX_HL_REF || !isOverlay(hl.styleId) ? undefined : this.layers.get(SYNTAX_HL_REF)?.get(line)
    if (!syntax?.length) return super.addHighlight(line, hl)
    const cuts = new Set([hl.start, hl.end])
    for (const s of syntax) {
      if (s.start > hl.start && s.start < hl.end) cuts.add(s.start)
      if (s.end > hl.start && s.end < hl.end) cuts.add(s.end)
    }
    const points = [...cuts].sort((a, b) => a - b)
    let run: NativeHighlight | null = null
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      let under: number | null = null
      for (const s of syntax) if (s.start <= a && s.end >= b) under = s.styleId // the last one shows
      const styleId = under === null ? hl.styleId : combinedStyle(hl.styleId, under)
      if (run && run.styleId === styleId) run.end = b
      else {
        if (run) super.addHighlight(line, run)
        run = { ...hl, start: a, end: b, styleId }
      }
    }
    if (run) super.addHighlight(line, run)
  }

  override removeHighlightsByRef(ref: number): void {
    this.drawn.delete(ref)
    for (const [line, list] of this.direct) {
      const keep = list.filter((h) => h.hlRef !== ref)
      if (keep.length === 0) this.direct.delete(line)
      else if (keep.length !== list.length) this.direct.set(line, keep)
    }
    super.removeHighlightsByRef(ref)
  }

  override clearLineHighlights(line: number): void {
    this.direct.delete(line)
    for (const byLine of this.drawn.values()) byLine.delete(line)
    super.clearLineHighlights(line)
  }

  override clearAllHighlights(): void {
    this.direct.clear()
    this.drawn.clear()
    super.clearAllHighlights()
  }

  override clear(): void {
    this.direct.clear()
    this.drawn.clear()
    super.clear()
  }

  private drawLayer(ref: number, w: { from: number; to: number }): void {
    const byLine = this.layers.get(ref)
    const next = new Map<number, LayerHighlight[]>()
    const last = Math.min(w.to, this.lineCount - 1)
    if (byLine) {
      for (let line = w.from; line <= last; line++) {
        const list = byLine.get(line)
        if (list) next.set(line, list)
      }
    }
    const old = this.drawn.get(ref)
    const changed = old ? changedLines(old, next) : null
    // A changed line costs a clear plus its highlights, so line by line wins until most of the
    // window changed (a scroll shifts it: lines leaving only need the clear).
    if (!changed || changed.length > Math.max(32, next.size)) {
      super.removeHighlightsByRef(ref)
      this.drawn.set(ref, next)
      // Overlays on a line were cut against the old colours: such a line is redrawn whole instead.
      const recut =
        ref === SYNTAX_HL_REF ? new Set([...next.keys(), ...(old?.keys() ?? [])].filter((line) => this.hasOverlay(line))) : null
      for (const [line, list] of next) if (!recut?.has(line)) for (const h of list) this.nativeAdd(line, layerHl(h, ref))
      for (const line of recut ?? []) this.redrawLine(line)
      return
    }
    this.drawn.set(ref, next)
    for (const line of changed) {
      // A line this layer never drew (it just came into the window): add to what is there.
      if (!old!.has(line) && !(ref === SYNTAX_HL_REF && this.hasOverlay(line))) {
        for (const h of next.get(line) ?? []) this.nativeAdd(line, layerHl(h, ref))
        continue
      }
      this.redrawLine(line)
    }
  }

  /** Clear a line and put back everything on it: the native buffer clears a line for every ref at once. */
  private redrawLine(line: number): void {
    super.clearLineHighlights(line)
    for (const [r, lines] of this.drawn) for (const h of lines.get(line) ?? []) this.nativeAdd(line, layerHl(h, r))
    for (const h of this.direct.get(line) ?? []) this.nativeAdd(line, h)
  }

  /** Whether an overlay (see nativeAdd) is drawn on a line. */
  private hasOverlay(line: number): boolean {
    if (this.direct.get(line)?.some((h) => isOverlay(h.styleId))) return true
    for (const [r, lines] of this.drawn)
      if (r !== SYNTAX_HL_REF && lines.get(line)?.some((h) => isOverlay(h.styleId))) return true
    return false
  }

  /**
   * Keep the drawn window around the viewport. Each native highlight costs tens of microseconds,
   * so a jump (Ctrl+End, go to definition) draws the screen first, and the margins follow a few
   * lines per frame; a scroll only adds the lines coming into view.
   */
  private followWindow(): void {
    if (!this.layers.size || !this.window) return
    const vp = this.editorView.getViewport()
    const top = this.wraps ? this.lineAtScreenY(this.y) : vp.offsetY
    const slack = Math.max(30, vp.height)
    const w = this.target ?? this.window
    const settled = (top - w.from >= slack || w.from === 0) && w.to - (top + vp.height) >= slack
    if (!settled) this.target = this.windowAround()
    const t = this.target
    if (!t) return
    const screen = { from: Math.max(t.from, top - SCREEN_MARGIN), to: Math.min(t.to, top + vp.height + SCREEN_MARGIN) }
    const cur = this.window
    const next =
      cur.to < screen.from || cur.from > screen.to
        ? screen // jumped: nothing drawn is on screen
        : {
            from: Math.max(t.from, Math.min(cur.from, screen.from) - GROW_STEP),
            to: Math.min(t.to, Math.max(cur.to, screen.to) + GROW_STEP),
          }
    this.window = next
    for (const ref of this.layers.keys()) this.drawLayer(ref, next)
    if (next.from === t.from && next.to === t.to) this.target = null
    else this.requestRender() // another frame to grow in
  }

  override onUpdate(deltaTime: number): void {
    super.onUpdate(deltaTime)
    this.followWindow()
  }

  override get logicalCursor(): ReturnType<TextareaRenderable["editBuffer"]["getCursorPosition"]> {
    const real = super.logicalCursor
    return this.parked ? { ...real, row: this.parked.row, col: this.parked.col } : real
  }

  /** True while the wheel has scrolled the cursor out of view. */
  get isParked(): boolean {
    return this.parked !== null
  }

  /** Put a parked cursor back where it was, scrolling the view to it. */
  unpark(): void {
    const p = this.parked
    if (!p) return
    this.parked = null
    this.showCursor = true
    super.setCursor(p.row, p.col)
  }

  /** Forget a parked cursor without restoring it (a click is about to place a new one). */
  private dropPark(): void {
    if (!this.parked) return
    this.parked = null
    this.showCursor = true
  }

  override setCursor(row: number, col: number): void {
    this.dropPark()
    super.setCursor(row, col)
  }

  override onMouseEvent(event: MouseEvent): void {
    if (event.button === RIGHT && (event.type === "down" || event.type === "up")) {
      if (event.type === "down") this.openContextMenu(event)
      return
    }
    if (
      event.button === LEFT &&
      event.type === "down" &&
      (event.modifiers.ctrl || event.modifiers.alt) &&
      this.onDefinitionClick
    ) {
      event.stopPropagation()
      const { row, col } = this.clickPos(event)
      const cb = this.onDefinitionClick
      queueMicrotask(() => cb(row, col))
      return
    }
    if (event.type === "scroll") this.scrollView(event)
    else {
      if (event.type === "down") this.dropPark()
      super.onMouseEvent(event)
    }
    if (this.onPointer && event.type !== "move" && event.type !== "over" && event.type !== "out") {
      const cb = this.onPointer
      // Selection and cursor updates from the renderer land after dispatch.
      queueMicrotask(() => cb(event))
    }
  }

  /** VS Code behaviour: a right-click outside the selection moves the cursor there first. */
  private openContextMenu(event: MouseEvent): void {
    event.stopPropagation()
    this.unpark()
    const { row, col: clampedCol } = this.clickPos(event)
    const offset = this.editBuffer.positionToOffset(row, clampedCol)
    const sel = this.hasSelection() ? this.getSelection() : null
    if (!sel || offset < Math.min(sel.start, sel.end) || offset > Math.max(sel.start, sel.end)) {
      this.clearSelection()
      this.setCursor(row, clampedCol)
    }
    const cb = this.onContextMenu
    if (cb) queueMicrotask(() => cb(event))
  }

  /** File position of a click, with the column clamped to the end of its line. */
  private clickPos(event: MouseEvent): { row: number; col: number } {
    const { row, col } = this.posAtScreen(event.x, event.y)
    const lineText = this.lineText(row)
    return { row, col: Math.min(col, Bun.stringWidth(lineText)) }
  }

  override handleKeyPress(key: KeyEvent): boolean {
    // Typing never waits for a scroll animation: a key ends it where it is.
    this.stopGlide()
    return this.editorKey(key) || super.handleKeyPress(key)
  }

  private editorKey(key: KeyEvent): boolean {
    const { name, ctrl, shift } = key
    const alt = key.meta || key.option
    if (!alt && !key.super) {
      if (name === "home") return ctrl ? this.fileEdge(-1, shift) : this.smartHome(shift)
      if (name === "end") return ctrl ? this.fileEdge(1, shift) : this.lineEnd(shift)
      if (ctrl && shift && name === "left") return this.moveWordBackward({ select: true })
      if (ctrl && shift && name === "right") return this.moveWordForward({ select: true })
      if (!ctrl && (name === "pageup" || name === "pagedown")) return this.page(name === "pageup" ? -1 : 1, shift)
    }
    // Mac: Cmd+Backspace / Cmd+Delete clear to the line's start / end (Cmd+arrows are the textarea's).
    if (key.super && !ctrl && !alt && (name === "backspace" || name === "delete")) {
      if (name === "backspace") this.deleteToLineStart()
      else this.deleteToLineEnd()
      return true
    }
    if (ctrl || alt || key.super) return false
    if (name === "escape" && this.hasSelection()) {
      this.clearSelection()
      return true
    }
    // Legacy terminals send Ctrl+Backspace as ^H and Backspace as DEL; both parse as "backspace".
    if (name === "backspace" && key.sequence === "\b") return this.deleteWordBackward()
    if (name === "return" || name === "kpenter") return this.autoIndent && this.enter()
    if (name === "backspace") return this.autoClosingBrackets && this.backspacePair()
    const ch = key.sequence
    if (this.autoClosingBrackets && ch?.length === 1 && isTypingPairChar(ch)) return this.typePairChar(ch)
    return false
  }

  /** One line's text, without copying the whole document out of the native buffer. */
  lineText(row: number): string {
    return this.lineRange(row, row)[0] ?? ""
  }

  /** Lines from..to (inclusive, clamped to the file), read without copying the whole document. */
  lineRange(from: number, to: number): string[] {
    from = Math.max(0, from)
    to = Math.min(to, this.lineCount - 1)
    if (to < from) return []
    const eb = this.editBuffer
    const start = eb.getLineStartOffset(from)
    const last = to + 1 >= this.lineCount
    const text = this.textRange(start, last ? Number.MAX_SAFE_INTEGER : eb.getLineStartOffset(to + 1))
    return (last ? text : text.slice(0, -1)).split("\n")
  }

  /** The cursor's line, with the cursor as a string index into it. */
  private cursorLine(): { row: number; col: number; line: string; index: number } {
    const { row, col } = this.editBuffer.getCursorPosition()
    const eol = this.editBuffer.getEOL()
    const line = this.getTextRangeByCoords(row, 0, row, eol.col)
    return { row, col, line, index: colToIndex(line, col) }
  }

  /** Line start (smart: the indent first) or end; Mac's Cmd+←/→ when they arrive as Ctrl+A / Ctrl+E. */
  gotoLineEdge(dir: -1 | 1): void {
    if (dir < 0) this.smartHome(false)
    else this.lineEnd(false)
  }

  private smartHome(select: boolean): boolean {
    this.updateSelectionForMovement(select, true)
    const { row, line, index } = this.cursorLine()
    this.editBuffer.setCursor(row, indexToCol(line, homeIndex(line, index)))
    this.updateSelectionForMovement(select, false)
    this.requestRender()
    return true
  }

  /** End stays on the line (the native one wraps to the next line when already at the end). */
  private lineEnd(select: boolean): boolean {
    this.updateSelectionForMovement(select, true)
    const eol = this.editBuffer.getEOL()
    this.editBuffer.setCursor(eol.row, eol.col)
    this.updateSelectionForMovement(select, false)
    this.requestRender()
    return true
  }

  /** Ctrl+Home/End. The native ones only drop a selection on the first press. */
  private fileEdge(dir: -1 | 1, select: boolean): boolean {
    if (!select) this.clearSelection()
    return dir < 0 ? this.gotoBufferHome({ select }) : this.gotoBufferEnd({ select })
  }

  /** PageUp/PageDown: move the cursor a screen and scroll with it, so it keeps its place on screen. */
  private page(dir: -1 | 1, select: boolean): boolean {
    const n = Math.max(1, this.editorView.getViewport().height - 1)
    // Smoothly, the cursor and the view travel together a few lines per frame (the native view
    // would snap back to a cursor left off screen, so they can't move separately).
    if (this.smoothScroll) this.glideBy(dir * n, (k) => this.pageBy(k, select))
    else this.pageBy(dir * n, select)
    return true
  }

  /** Move the cursor `k` lines and the view with it. */
  private pageBy(k: number, select: boolean): void {
    const view = this.editorView
    const vp = view.getViewport()
    for (let i = 0; i < Math.abs(k); i++) {
      if (k < 0) this.moveCursorUp({ select })
      else this.moveCursorDown({ select })
    }
    const maxY = Math.max(0, view.getTotalVirtualLineCount() - vp.height)
    view.setViewport(vp.offsetX, Math.max(0, Math.min(maxY, vp.offsetY + k)), vp.width, vp.height, false)
    this.requestRender()
  }

  // ---- smooth scrolling ----

  private glider = new Glide(true, 16, this._ctx)
  /** Glide scrolls instead of jumping (editor.smoothScrolling). */
  get smoothScroll(): boolean {
    return this.glider.enabled
  }
  set smoothScroll(on: boolean) {
    this.glider.enabled = on
  }

  private glideBy(total: number, move: (k: number) => void): void {
    this.glider.by(total, (k) => (this.isDestroyed ? this.glider.stop() : move(k)))
  }

  /** End a scroll animation where it is. */
  stopGlide(): void {
    this.glider.stop()
  }

  private enter(): boolean {
    if (this.hasSelection()) this.deleteCharBackward()
    const { row, line, index } = this.cursorLine()
    const unit = () => {
      const lines = this.textRange(0, 200_000).split("\n") // the start of the file is enough to guess
      return indentString(lines, indentUnit(lines))
    }
    const { text, caret } = enterText(line, index, unit)
    this.insertText(text)
    if (caret < text.length) {
      const before = text.slice(0, caret).split("\n")
      this.setCursor(row + before.length - 1, Bun.stringWidth(before.at(-1)!))
    }
    return true
  }

  private backspacePair(): boolean {
    if (this.hasSelection()) return false
    const { row, col, line, index } = this.cursorLine()
    if (!deletesPair(line, index)) return false
    this.deleteRange(row, col - 1, row, col + 1)
    this.setCursor(row, col - 1)
    return true
  }

  private typePairChar(ch: string): boolean {
    const close = PAIRS[ch]
    if (this.hasSelection()) {
      if (!close) return false
      // Typing a bracket or quote over a selection wraps it, keeping the text selected.
      const sel = this.getSelection()!
      const text = this.getSelectedText()
      const start = Math.min(sel.start, sel.end) + 1
      this.insertText(ch + text + close)
      const end = this.editBuffer.offsetToPosition(start + text.length)
      if (end) this.setCursor(end.row, end.col)
      this.setSelection(start, start + text.length)
      this.requestRender()
      return true
    }
    const { line, index } = this.cursorLine()
    const act = typeChar(ch, line, index)
    if (act === "over") return this.moveCursorRight()
    if (act !== "pair") return false
    this.insertText(ch + close)
    return this.moveCursorLeft()
  }

  /** Scroll so `row` is visible, centring it when it was off screen (no wrapping in this editor). */
  revealLine(row: number, col = 0): void {
    const view = this.editorView
    const vp = view.getViewport()
    let { offsetX: x, offsetY: y } = vp
    const visual = this.visualRowOf(row)
    if (visual < y || visual >= y + vp.height) y = Math.max(0, visual - Math.floor(vp.height / 3))
    if (!this.wraps && (col < x || col >= x + vp.width)) x = Math.max(0, col - Math.floor(vp.width / 2))
    if (x !== vp.offsetX || y !== vp.offsetY) {
      view.setViewport(x, y, vp.width, vp.height, false)
      this.requestRender()
    }
  }

  /** Move the cursor to (row, col) and bring it into view. */
  goTo(row: number, col: number): void {
    this.unpark()
    this.clearSelection()
    this.setCursor(row, col)
    this.revealLine(row, col)
  }

  /** Select columns startCol..endCol of `row` with the cursor at the end, and reveal it. */
  selectRange(row: number, startCol: number, endCol: number): void {
    this.unpark()
    const eb = this.editBuffer
    this.setCursor(row, endCol)
    this.setSelection(eb.positionToOffset(row, startCol), eb.positionToOffset(row, endCol))
    this.revealLine(row, startCol)
    this.requestRender()
  }

  /** Screen cell of the cursor (for popups), or null when it is scrolled out of view. */
  cursorScreenPos(): { x: number; y: number } | null {
    const vp = this.editorView.getViewport()
    const c = this.editorView.getVisualCursor()
    const x = c.visualCol - vp.offsetX
    const y = c.visualRow - vp.offsetY
    if (x < 0 || y < 0 || x > vp.width || y >= vp.height) return null
    return { x: this.x + x, y: this.y + y }
  }

  /** Screen row of a file line, or null when it is scrolled out of view. */
  rowScreenY(row: number): number | null {
    const vp = this.editorView.getViewport()
    const y = this.visualRowOf(row) - vp.offsetY
    return y < 0 || y >= vp.height ? null : this.y + y
  }

  /** Replace columns startCol..endCol of `row` with text, leaving the cursor after it. */
  replaceRange(row: number, startCol: number, endCol: number, text: string): void {
    this.unpark()
    this.clearSelection()
    if (endCol > startCol) this.deleteRange(row, startCol, row, endCol)
    this.setCursor(row, startCol)
    this.insertText(text)
  }

  private get wraps(): boolean {
    return this.wrapMode !== "none"
  }

  /**
   * Where the view is: its offsets and size in cells, and the content's size. The columns are
   * the longest line on screen's (0 when lines wrap): the view can only scroll sideways where
   * a line reaches (see scrollViewBy), so the horizontal bar shows what can be scrolled here.
   */
  scrollState(): ScrollState {
    const vp = this.editorView.getViewport()
    const lines = this.editorView.getTotalVirtualLineCount()
    // One column past the longest line, so its end can be scrolled into view with the cursor after it.
    const cols = this.wraps ? 0 : this.widestOnScreen(vp.offsetY, vp.height) + 1
    return { x: vp.offsetX, y: vp.offsetY, width: vp.width, height: vp.height, cols, lines }
  }

  /** The width of the longest line among `height` visual rows from `y`. */
  private widestOnScreen(y: number, height: number): number {
    const widths = this.visualLines().lineWidthCols
    let w = 0
    for (let r = y; r < Math.min(y + height, widths.length); r++) w = Math.max(w, widths[r] ?? 0)
    return w
  }

  private reportScroll(): void {
    if (!this.onScroll) return
    const s = this.scrollState()
    const key = `${s.x}:${s.y}:${s.width}:${s.height}:${s.cols}:${s.lines}`
    if (key === this.lastScroll) return
    this.lastScroll = key
    this.onScroll(s)
  }

  /** Scroll the view to column `x` and line `y` (a scrollbar's thumb), keeping the cursor where it is. */
  scrollTo(x: number | null, y: number | null): void {
    const vp = this.editorView.getViewport()
    const dx = x === null ? 0 : Math.max(0, Math.round(x)) - vp.offsetX
    const dy = y === null ? 0 : Math.max(0, Math.round(y)) - vp.offsetY
    if (!dx && !dy) return
    this.stopGlide()
    this.scrollViewBy(dx, dy)
  }

  /** First screen (visual) row of a file line; the same number unless lines wrap. */
  visualRowOf(row: number): number {
    if (!this.wraps) return row
    const i = this.lineInfo.lineSources.indexOf(row)
    return i === -1 ? row : i
  }

  /** File line and column under a screen cell (handles wrapped lines). */
  posAtScreen(screenX: number, screenY: number): { row: number; col: number } {
    const vp = this.editorView.getViewport()
    const visual = Math.max(0, Math.floor(vp.offsetY + (screenY - this.y)))
    if (!this.wraps) {
      const row = Math.max(0, Math.min(this.lineCount - 1, visual))
      return { row, col: Math.max(0, Math.floor(vp.offsetX + (screenX - this.x))) }
    }
    const info = this.lineInfo
    const v = Math.min(visual, info.lineSources.length - 1)
    const row = info.lineSources[v] ?? this.lineCount - 1
    return { row, col: (info.lineStartCols[v] ?? 0) + Math.max(0, screenX - this.x) }
  }

  /** File line under a screen row. */
  lineAtScreenY(screenY: number): number {
    return this.posAtScreen(this.x, screenY).row
  }

  /**
   * Select whole lines a..b (inclusive, any order), including the trailing newline when there
   * is one. The cursor goes to the end the drag is at (b), like VS Code.
   */
  selectLines(a: number, b: number): void {
    const first = Math.max(0, Math.min(a, b))
    const last = Math.min(this.lineCount - 1, Math.max(a, b))
    const eb = this.editBuffer
    const start = eb.getLineStartOffset(first)
    let end: number
    let endPos: { row: number; col: number }
    if (last + 1 < this.lineCount) {
      end = eb.getLineStartOffset(last + 1)
      endPos = { row: last + 1, col: 0 }
    } else {
      const text = this.plainText
      const col = Bun.stringWidth(text.slice(text.lastIndexOf("\n") + 1))
      end = eb.positionToOffset(last, col)
      endPos = { row: last, col }
    }
    const forward = b >= a
    const cursor = forward ? endPos : { row: first, col: 0 }
    this.setCursor(cursor.row, cursor.col)
    this.setSelection(forward ? start : end, forward ? end : start)
    this.requestRender()
  }

  private scrollView(event: MouseEvent): void {
    if (!event.scroll) return
    const { direction, delta } = event.scroll
    // Shift+wheel scrolls horizontally, like most editors.
    const dir = event.modifiers.shift ? ({ up: "left", down: "right", left: "up", right: "down" } as const)[direction] : direction
    const vertical = dir === "up" || dir === "down"
    const amount = dir === "up" || dir === "left" ? -delta : delta
    // Vertical wheel steps glide; sideways ones are rare and stay instant.
    if (this.smoothScroll && vertical) this.glideBy(amount, (k) => this.scrollViewBy(0, k))
    else this.scrollViewBy(vertical ? 0 : amount, vertical ? amount : 0)
  }

  /**
   * The native view keeps its cursor this many columns from the sides (its scroll margin, a
   * fifth of the width), scrolling sideways to it on every frame otherwise.
   */
  private marginCols(width: number): number {
    return Math.min(Math.max(1, Math.floor(width * 0.2)), Math.floor(Math.max(0, width - 1) / 2))
  }

  /** Whether the native view leaves offset `x` alone with its cursor at `col` (true when lines wrap: no sideways scrolling then). */
  private holdsX(col: number, x: number, width: number): boolean {
    if (this.wraps) return true
    const m = this.marginCols(width)
    return (col >= x + m && col < x + width - m) || (x === 0 && col < m)
  }

  /** Whether the native view leaves offset `y` alone with its cursor on visual row `row`. */
  private holdsY(row: number, y: number, height: number): boolean {
    const m = Math.min(Math.max(1, Math.floor(height * 0.2)), Math.floor(Math.max(0, height - 1) / 2))
    if (row < y + m) return Math.max(0, row - m) === y
    if (row >= y + height - m) {
      const maxY = Math.max(0, this.editorView.getTotalVirtualLineCount() - height)
      return Math.min(row + m - height + 1, maxY) === y
    }
    return true
  }

  /** Scroll the view (not the cursor) by dx columns and dy lines, parking the cursor as needed. */
  private scrollViewBy(dx: number, dy: number): void {
    const view = this.editorView
    const vp = view.getViewport()
    const maxY = Math.max(0, view.getTotalVirtualLineCount() - vp.height)
    const y = Math.max(0, Math.min(maxY, vp.offsetY + dy))
    const maxX = this.wraps ? 0 : Math.max(0, this.widestOnScreen(y, vp.height) + 1 - vp.width)
    let x = Math.max(0, Math.min(maxX, vp.offsetX + dx))
    if (x === vp.offsetX && y === vp.offsetY) return this.stopGlide() // reached the top or bottom
    // With a selection the native cursor is its active end; let it ride as the native view wants.
    if (this.hasSelection()) {
      view.setViewport(x, y, vp.width, vp.height, true)
      this.requestRender()
      return
    }
    const before = this.logicalCursor
    view.setViewport(x, y, vp.width, vp.height, true)
    let now = super.logicalCursor
    // Sideways, the native view moves no cursor: it would scroll back to its column on the next
    // frame. Put it on a column that holds the view, on its row when that is long enough, else
    // on the longest row on screen; no row reaching that far means the view can't go there.
    if (x !== vp.offsetX && !this.holdsX(now.col, x, vp.width)) {
      const widths = this.visualLines().lineWidthCols
      const m = this.marginCols(vp.width)
      let row = now.row
      if ((widths[row] ?? 0) < x + m) {
        for (let r = y; r < Math.min(y + vp.height, widths.length); r++) if ((widths[r] ?? 0) > (widths[row] ?? 0)) row = r
        if ((widths[row] ?? 0) < x + m) {
          x = Math.max(0, (widths[row] ?? 0) - m)
          view.setViewport(x, y, vp.width, vp.height, false)
        }
      }
      const col = x === 0 && now.col < m ? now.col : Math.max(x + m, Math.min(now.col, x + vp.width - m - 1, widths[row] ?? 0))
      this.editBuffer.setCursor(row, col)
      now = super.logicalCursor
    }
    if (!this.parked && (now.row !== before.row || now.col !== before.col)) {
      this.parked = { row: before.row, col: before.col }
      this.showCursor = false
    } else if (this.parked) {
      // Scrolled back far enough that the native view would leave the real cursor alone.
      const { row, col } = this.parked
      if (this.holdsY(this.visualRowOf(row), y, vp.height) && this.holdsX(col, x, vp.width)) this.unpark()
      else if (row === now.row && col === now.col) this.dropPark()
    }
    this.requestRender()
  }
}

extend({ "code-editor": CodeEditorRenderable })

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "code-editor": typeof CodeEditorRenderable
  }
}
