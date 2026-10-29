import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { setStyleOwner } from "../editor/syntaxStyle"
import { EditorPane } from "../editor/EditorPane"
import { useAppKeymap } from "../keymap/useAppKeymap"
import { ui as colors } from "../config/theme"
import { StatusBar } from "./StatusBar"
import { closeModal } from "./modalStack"
import { ConfirmModal } from "./ConfirmModal"
import { HelpModal } from "./HelpModal"
import { ContextMenu } from "./ContextMenu"
import { DOUBLE_CLICK_MS } from "./Modal"
import { PromptModal } from "./PromptModal"
import { CommandPalette } from "./CommandPalette"
import { InfoPopup } from "./InfoPopup"
import { RecentModal } from "./RecentModal"
import { MergeAgentModal } from "../ai/MergeAgentModal"
import { TurnsModal } from "../ai/TurnsModal"
import { ProblemsModal } from "../lsp/ProblemsModal"
import { LocationsModal } from "../lsp/LocationsModal"
import { CompletionPopup } from "../lsp/CompletionPopup"
import { SignaturePopup } from "../lsp/SignaturePopup"
import { MultiEdit } from "../editor/MultiEdit"
import { DiffModal } from "../editor/ConflictBar"
import { SourceControlPanel } from "../git/SourceControlPanel"
import { HunkPeek } from "../git/HunkPeek"
import { HistoryModal } from "../git/HistoryModal"
import { BranchPicker } from "../git/BranchPicker"
import { useBufferSelector, useUi, useWorkspace } from "./workspace"
import type { UiState } from "./state"
import type { ReactNode } from "react"

const MIN_TREE = 14
const MIN_AI = 30
const MIN_EDITOR = 30

/** Pane widths, honouring dragged sizes but always leaving room for the editor. */
export function paneWidths(
  total: number,
  ui: Pick<UiState, "treeWidth" | "aiWidth">,
  showTree: boolean,
  showAi: boolean,
): { treeWidth: number; aiWidth: number } {
  let tree = ui.treeWidth ?? Math.min(32, Math.max(20, Math.floor(total * 0.18)))
  let ai = ui.aiWidth ?? Math.max(40, Math.floor(total * 0.4))
  tree = Math.max(MIN_TREE, tree)
  ai = Math.max(MIN_AI, ai)
  // Leave the editor its minimum, plus one column per visible divider.
  const room = total - MIN_EDITOR - (showTree ? 1 : 0) - (showAi ? 1 : 0)
  if (showTree) tree = Math.min(tree, room - (showAi ? MIN_AI : 0))
  if (showAi) ai = Math.min(ai, room - (showTree ? tree : 0))
  return { treeWidth: tree, aiWidth: ai }
}

/**
 * The 1-column line between two panes; drag it to resize, double-click to go back to the default
 * width (as in VS Code). Brightens on hover and while dragging.
 */
function Divider({ side }: { side: "tree" | "ai" }) {
  const ws = useWorkspace()
  const ui = useUi()
  const [hover, setHover] = useState(false)
  const lastPress = useRef(0)
  const active = hover || ui.resizing === side
  return (
    // A coloured column, not a line glyph: box-drawing characters differ between terminals and
    // fonts (Windows Terminal draws its own), a cell's background looks the same everywhere.
    <box
      width={1}
      flexShrink={0}
      backgroundColor={ui.resizing === side ? colors.borderFocused : hover ? colors.accentDim : colors.divider}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        const now = Date.now()
        if (now - lastPress.current < DOUBLE_CLICK_MS) {
          lastPress.current = 0
          ws.ui.set(side === "tree" ? { resizing: null, treeWidth: null } : { resizing: null, aiWidth: null })
          return
        }
        lastPress.current = now
        ws.ui.set({ resizing: side })
      }}
    />
  )
}

export interface AppSlots {
  tree?: ReactNode
  ai?: ReactNode
  picker?: ReactNode
  search?: ReactNode
  aiStatus?: { subscribe: (l: () => void) => () => void; get: () => string }
}

const noStatus = { subscribe: () => () => {}, get: () => "" }

export function App({ slots = {} }: { slots?: AppSlots }) {
  // Syntax colours are native resources of this renderer (a test makes a new one each time).
  setStyleOwner(useRenderer().nativeScene)
  const ws = useWorkspace()
  const ui = useUi()
  const dims = useTerminalDimensions()
  const bindings = useAppKeymap()
  const status = slots.aiStatus ?? noStatus
  const aiStatus = useSyncExternalStore(status.subscribe, status.get)

  // A context menu can open over a dialog (Source control's file menu): the dialog stays under it.
  const modal = ui.modal?.kind === "menu" ? (ui.modal.back ?? null) : ui.modal
  // Source control stays on screen under what it opened (branches, history, a question): one element,
  // drawn before the other dialogs so they come above it and it keeps its state when it is back on top.
  let scm = false
  for (let m = ui.modal; m && !scm; m = m.back ?? null) scm = m.kind === "scm"

  const tooSmall = dims.width < 60 || dims.height < 12
  // Too small to draw a dialog, which then can't take its keys: Escape still closes it.
  useKeyboard((key) => {
    if (tooSmall && key.name === "escape" && ws.ui.get().modal) closeModal(ws)
  })
  const showTree = ui.treeVisible && !!slots.tree && dims.width >= 100
  const showAi = ui.aiVisible && !!slots.ai
  const { treeWidth, aiWidth } = paneWidths(dims.width, ui, showTree, showAi)
  // editor.startHidden: no editor until a file opens. "Maximize AI": the editor only takes room once you
  // open a file or show it (Ctrl+E). Both: until its last tab closes.
  const fileCount = useBufferSelector((b) => b.list().length)
  const emptyHidden = ws.config.editor.startHidden && fileCount === 0
  const hideEditor = showAi && (emptyHidden || (!!ui.aiMaximized && (!ui.aiMaximized.editor || fileCount === 0)))
  const fullAi = dims.width - (showTree ? treeWidth + 1 : 0)
  useEffect(() => {
    if (!hideEditor || ui.focus !== "editor") return
    // A file opened (tree, Ctrl+P, links) into the hidden editor: show it beside the AI pane.
    if (fileCount && ui.aiMaximized) return ws.ui.set({ aiMaximized: { ...ui.aiMaximized, editor: true } })
    // The last tab just closed: the hidden editor can't hold the keyboard, the AI takes it.
    ws.ui.set({ focus: "ai" })
    ws.ai?.focus()
  }, [hideEditor, ui.focus, ui.aiMaximized, ws, fileCount])

  if (tooSmall) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={colors.bg}>
        <text fg={colors.warn}>
          Terminal too small ({dims.width}x{dims.height}). Need at least 60x12. ^Q quits.
        </text>
      </box>
    )
  }

  const onDrag = (x: number) => {
    // The dragged divider follows the pointer: tree | x | editor | x | ai.
    if (ui.resizing === "tree") ws.ui.set({ treeWidth: Math.max(1, x) })
    else if (ui.resizing === "ai") ws.ui.set({ aiWidth: Math.max(1, dims.width - x - 1) })
  }

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={colors.bg}
      onMouseDrag={(e) => ui.resizing && onDrag(e.x)}
      onMouseUp={() => ui.resizing && ws.ui.set({ resizing: null })}
    >
      <box flexDirection="row" flexGrow={1}>
        {showTree ? (
          <box width={treeWidth} flexShrink={0} flexDirection="column">
            {slots.tree}
          </box>
        ) : null}
        {showTree ? <Divider side="tree" /> : null}
        {hideEditor ? null : <EditorPane />}
        {showAi && slots.ai && !hideEditor ? <Divider side="ai" /> : null}
        {/* Keep the AI pane mounted when hidden so the CLI session survives toggling. */}
        {slots.ai ? (
          <box width={hideEditor ? fullAi : showAi ? aiWidth : 0} flexShrink={0} flexDirection="column" visible={showAi}>
            {slots.ai}
          </box>
        ) : null}
      </box>
      <StatusBar aiStatus={aiStatus} />
      {scm ? <SourceControlPanel /> : null}
      {modal?.kind === "confirm" ? <ConfirmModal modal={modal} /> : null}
      {modal?.kind === "help" ? <HelpModal bindings={bindings} /> : null}
      {modal?.kind === "prompt" ? <PromptModal key={modal.title + modal.initial} modal={modal} /> : null}
      {modal?.kind === "picker" ? slots.picker : null}
      {modal?.kind === "search" ? slots.search : null}
      {modal?.kind === "diff" ? <DiffModal bufId={modal.bufId} /> : null}
      {modal?.kind === "branches" ? <BranchPicker mode={modal.mode ?? "switch"} /> : null}
      {modal?.kind === "history" ? <HistoryModal path={modal.path} sha={modal.sha} /> : null}
      {modal?.kind === "palette" ? <CommandPalette bindings={bindings} /> : null}
      {modal?.kind === "info" ? <InfoPopup x={modal.x} y={modal.y} text={modal.text} /> : null}
      {modal?.kind === "problems" ? <ProblemsModal /> : null}
      {modal?.kind === "recent" ? <RecentModal /> : null}
      {modal?.kind === "turns" ? <TurnsModal /> : null}
      {modal?.kind === "mergeAgent" ? <MergeAgentModal sessionId={modal.sessionId} /> : null}
      {modal?.kind === "locations" ? <LocationsModal title={modal.title} locations={modal.locations} /> : null}
      <CompletionPopup />
      <SignaturePopup />
      <MultiEdit />
      <HunkPeek />
      {ui.modal?.kind === "menu" ? <ContextMenu key={`${ui.modal.x},${ui.modal.y}`} menu={ui.modal} /> : null}
      {/* reference ws so the root re-renders on workspace swaps in tests */}
      {ws ? null : null}
    </box>
  )
}
