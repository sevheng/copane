import { createContext, useContext, useSyncExternalStore } from "react"
import type { CursorStyleOptions } from "@opentui/core"
import { BufferStore } from "../editor/BufferStore"
import { createUiStore, type Notice, type UiState } from "./state"
import type { Store } from "./store"
import { configSchema, type Config } from "../config/schema"
import { createClipboard, type Clipboard } from "./clipboard"
import type { GitRepos } from "../git/repos"
import type { LspManager } from "../lsp/LspManager"
import type { TurnLog } from "../ai/turns"
import type { AiReview } from "../ai/review"
import type { RestoreState } from "./update"
import { keyText } from "../keymap/keys"
import { keyStyleOf } from "../keymap/platform"

export interface Workspace {
  root: string
  config: Config
  clipboard: Clipboard
  buffers: BufferStore
  ui: Store<UiState>
  notify(text: string, kind?: Notice["kind"]): void
  /** Set by the AI pane once mounted; used by "send to AI" and shutdown. */
  ai: AiHandle | null
  /** Git status of the workspace (null outside the app, e.g. in tests). */
  git: GitRepos | null
  /** Language servers (diagnostics, completion, hover, definition); null in tests. */
  lsp: LspManager | null
  /** What the AI changed per turn (prompt), for review and undo; null in tests. */
  turns: TurnLog | null
  /** Unreviewed AI edits per file (gutter markers, Alt+N); null in tests. */
  review: AiReview | null
  /** The AI pane's tabs (several agents), set by the pane once mounted. */
  agents: AgentTabs | null
}

/** Controls the AI pane's agent tabs. */
export interface AgentTabs {
  /** Show the menu of agents to start (each also offered in its own git worktree). */
  openMenu(x?: number, y?: number): void
  /** Switch to the next (1) or previous (-1) tab. */
  cycle(dir: 1 | -1): void
  /** Close the visible tab (not the last one). */
  closeActive(): void
  /** A tab's folder and, for a worktree agent, its branch. */
  session(id: number): { id: number; name: string; cwd: string; branch: string | null; worktree?: string } | undefined
  /** The visible tab's id. */
  activeId(): number
  /** Close a tab right away (no questions; its worktree is the caller's business). The last tab is replaced by a fresh one in the project. */
  close(id: number): void
  /** Stop a tab's CLI and wait until it has exited (before touching its files). */
  stop(id: number): Promise<void>
  /** Recount what a worktree agent changed (shown on its tab). */
  recount(id: number): void
  /** Show the project's dev servers to run in terminal tabs, marking the running ones. */
  openRun(x?: number, y?: number): void
  /** Open a terminal tab (your shell) in the project. */
  newTerminal(): void
  /** The open tabs, saved by a restart to open again. */
  snapshot(): RestoreState["ai"]
  /** Copy the visible tab's mouse selection; false when nothing is selected. */
  copySelection(): boolean
  /** A terminal's error (the visible one's, else the newest), typed into the AI's prompt (not submitted). False when there is none. */
  sendTerminalError(): boolean
}

export interface AiHandle {
  /** Insert text into the CLI's input as if pasted. */
  paste(text: string): void
  /** Send text as if typed. Must not contain newlines (they would submit). */
  type(text: string): void
  /** Press Enter in the CLI (submit the prompt). */
  submit(): void
  focus(): void
  restart(): void
  kill(): void
}

export function createWorkspace(
  root: string,
  ui?: Partial<UiState>,
  config: Config = configSchema.parse({}),
  clipboard: Clipboard = createClipboard({ tool: null }),
): Workspace {
  const uiStore = createUiStore(ui)
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  const ws: Workspace = {
    root,
    config,
    clipboard,
    buffers: new BufferStore({ root, highlightMaxBytes: config.editor.highlightMaxBytes }),
    ui: uiStore,
    ai: null,
    git: null,
    lsp: null,
    turns: null,
    review: null,
    agents: null,
    notify(text, kind = "info") {
      uiStore.set({ notice: { text: keyText(text, keyStyleOf(config)), kind } })
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => uiStore.set({ notice: null }), kind === "error" ? 8000 : 4000)
    },
  }
  return ws
}

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext)
  if (!ws) throw new Error("WorkspaceContext missing")
  return ws
}

const cursorStyles = new Map<string, CursorStyleOptions>()
/** The text cursor for the editor and every input (`editor.cursorStyle`), one object per style. */
export function useCursorStyle(): CursorStyleOptions {
  const style = useWorkspace().config.editor.cursorStyle
  let opts = cursorStyles.get(style)
  if (!opts) cursorStyles.set(style, (opts = { style, blinking: true }))
  return opts
}

/** Key names in UI text ("Ctrl+Z undoes") as this keyboard writes them (⌘Z on a Mac). */
export function useKeyText(): (text: string) => string {
  const ws = useWorkspace()
  return (text) => keyText(text, keyStyleOf(ws.config))
}

export function useUi(): UiState {
  const ws = useWorkspace()
  return useSyncExternalStore(ws.ui.subscribe, ws.ui.get)
}

/**
 * The active buffer's cursor; re-renders when it moves or another tab becomes active. Cursor moves
 * don't reach useBuffers(), so only the views that show the position re-render on each key.
 */
export function useCursor(): { row: number; col: number } | null {
  const ws = useWorkspace()
  const b = ws.buffers
  useSyncExternalStore(
    (l) => {
      const a = b.subscribe(l)
      const c = b.subscribeCursor(l)
      return () => (a(), c())
    },
    () => b.getSnapshot() * 1_000_003 + b.getCursorSnapshot(),
  )
  return b.active?.cursor ?? null
}

/**
 * One value derived from the buffer store; re-renders only when it changes. `select` must return a
 * primitive (or a stable object) so unchanged results compare equal.
 */
export function useBufferSelector<T>(select: (buffers: BufferStore) => T): T {
  const ws = useWorkspace()
  return useSyncExternalStore(ws.buffers.subscribe, () => select(ws.buffers))
}

/** Re-render on any buffer store change (not cursor moves: useCursor); returns the store. */
export function useBuffers(): BufferStore {
  const ws = useWorkspace()
  useSyncExternalStore(ws.buffers.subscribe, ws.buffers.getSnapshot)
  return ws.buffers
}
