import { basename, relative } from "node:path"
import type { Workspace } from "../app/workspace"
import { shutdown } from "../app/shutdown"
import { isCompiled, restart } from "../app/update"
import pkg from "../../package.json"
import { openFind, wordUnderCursor } from "../editor/FindBar"
import { gotoChange, revertHunkAt, stageHunk } from "../git/hunkActions"
import { blameFor } from "../git/blame"
import { navigateBack, navigateForward, recordJump } from "../app/navHistory"
import { acceptConflict, conflictsOf, gotoConflict } from "../git/conflictActions"
import { conflictAt } from "../editor/conflicts"
import { NOT_COMMITTED } from "../git/repo"
import { addNextOccurrence, multiPaste, selectAllOccurrences } from "../editor/MultiEdit"
import {
  findReferences,
  formatDocument,
  goToDefinition,
  nextProblem,
  organizeImports,
  quickFix,
  renameSymbol,
  showHover,
} from "../lsp/lspActions"
import { completeNow } from "../lsp/CompletionPopup"
import { parseGoto } from "../editor/search"
import { deleteLine, duplicateLine, indent, moveLine, outdent, toggleLineComment, trimWhitespace } from "../editor/lineCommands"
import { lineAt, type CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import { BinaryFileError, ControlCharsError, DiskChangedError } from "../editor/fileio"
import type { Buffer } from "../editor/BufferStore"
import { formatContextForAgent } from "../ai/sendToAgent"
import { sendChangesForReview, sendProblems } from "../ai/askAi"
import { reportProblem } from "../ai/reportIssue"
import { acceptAiChangeAt, gotoAiChange, undoAiChangeAt, undoAiFile } from "../ai/review"
import { decodeForBuffer } from "../editor/fileio"
import { configPath } from "../config/load"
import { importVSCodeSettings } from "../config/vscode"
import { revealInFileManager } from "../files/reveal"
import { closeModal, openOver } from "../app/modalStack"
import { macKeys } from "./platform"

/**
 * Alt+1..9 go to that tab (Alt+9 the last), as in VS Code. In a merge conflict Alt+1/2/3
 * accept current / incoming / both instead.
 */
function altNumber(ws: Workspace, n: number): void {
  const buf = ws.buffers.active
  const row = buf?.textarea?.logicalCursor.row
  if (n <= 3 && buf && row !== undefined && ws.ui.get().focus === "editor" && conflictAt(conflictsOf(buf.id), row)) {
    return acceptConflict(ws, (["current", "incoming", "both"] as const)[n - 1]!)
  }
  const list = ws.buffers.list()
  const target = n === 9 ? list.at(-1) : list[n - 1]
  if (target) {
    ws.buffers.activate(target.id)
    ws.ui.set({ focus: "editor" })
  }
}

/** On a Markdown file, open its preview tab; on a preview tab, go back to the file. */
async function openPreview(ws: Workspace): Promise<void> {
  const buf = ws.buffers.active
  if (buf?.kind === "preview") {
    await ws.buffers.open(buf.source!)
  } else if (buf?.filetype === "markdown") {
    ws.buffers.openPreview(buf.path)
  } else {
    return ws.notify("Not a Markdown file")
  }
  ws.ui.set({ focus: "editor" })
}

async function reopenClosed(ws: Workspace): Promise<void> {
  const open = new Set(ws.buffers.list().map((b) => b.path))
  let path: string | undefined
  while ((path = ws.buffers.closed.pop()) && open.has(path));
  if (!path) return ws.notify("No closed tabs to reopen")
  try {
    await ws.buffers.open(path)
    ws.ui.set({ focus: "editor" })
  } catch (err) {
    ws.notify(`Could not reopen: ${(err as Error).message}`, "error")
  }
}

async function importVSCode(ws: Workspace): Promise<void> {
  try {
    const result = await importVSCodeSettings(configPath())
    if (!result) return ws.notify("VS Code settings not found", "warn")
    const keys = Object.entries(result.imported)
    if (!keys.length) return ws.notify("No VS Code settings to import (only defaults there)")
    // Settings read on use apply now; the rest (word wrap's default) after a restart.
    Object.assign(ws.config.editor, result.imported)
    ws.notify(`Imported from VS Code: ${keys.map(([k, v]) => `${k} ${v}`).join(", ")}. Ctrl+Alt+R applies all`)
  } catch (err) {
    ws.notify(`Import failed: ${(err as Error).message}`, "error")
  }
}

/** Open the config file in a tab, creating it when missing, like VS Code's "Open Settings (JSON)". */
async function openConfig(ws: Workspace): Promise<void> {
  const path = configPath()
  try {
    if (!(await Bun.file(path).exists())) await Bun.write(path, "{\n}\n")
    await ws.buffers.open(path)
    ws.ui.set({ focus: "editor" })
    ws.notify("Most settings apply after a restart (Ctrl+Alt+R)")
  } catch (err) {
    ws.notify(`Could not open settings: ${(err as Error).message}`, "error")
  }
}

export interface Command {
  title: string
  run(ws: Workspace): void | Promise<void>
}

async function saveActive(ws: Workspace): Promise<void> {
  const buf = ws.buffers.active
  if (!buf) return
  if (ws.config.editor.formatOnSave) await formatDocument(ws, { quiet: true })
  try {
    await ws.buffers.save(buf.id)
    ws.notify(`Saved ${buf.relPath}`)
  } catch (err) {
    if (err instanceof DiskChangedError) return askOverwrite(ws, buf)
    if (err instanceof ControlCharsError) return askDropControlChars(ws, buf)
    ws.notify(`Save failed: ${(err as Error).message}`, "error")
  }
}

/** The file changed on disk under unsaved edits: overwrite it, compare first, or leave it. */
function askOverwrite(ws: Workspace, buf: Buffer): void {
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: `${buf.relPath} changed on disk`,
      body: "The file changed since you opened it (the AI, or another program). Saving now would replace that change with your version.",
      options: [
        {
          key: "o",
          label: "Overwrite it with my version",
          run: async () => {
            ws.ui.set({ modal: null })
            await ws.buffers.save(buf.id, { force: true })
            ws.notify(`Saved ${buf.relPath}`)
          },
        },
        { key: "c", label: "Compare first", run: () => openOver(ws, { kind: "diff", bufId: buf.id }) },
        { key: "escape", label: "Cancel", run: () => ws.ui.set({ modal: null }) },
      ],
    },
  })
}

/** The file has characters the editor dropped (form feeds…): saving writes it without them. */
function askDropControlChars(ws: Workspace, buf: Buffer): void {
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: `Save ${buf.relPath}?`,
      body: "This file has control characters (form feeds, escape codes…) the editor can't hold. Saving writes it without them.",
      options: [
        {
          key: "s",
          label: "Save without them",
          run: async () => {
            ws.ui.set({ modal: null })
            await ws.buffers.save(buf.id, { force: true })
            ws.notify(`Saved ${buf.relPath}`)
          },
        },
        { key: "escape", label: "Cancel (keep the file as it is)", run: () => ws.ui.set({ modal: null }) },
      ],
    },
  })
}

/** Save every dirty buffer. False (and a notice) when any failed or needs a decision first. */
async function saveAll(ws: Workspace): Promise<boolean> {
  const changedOnDisk: string[] = []
  for (const b of ws.buffers.list()) {
    if (!b.dirty) continue
    try {
      await ws.buffers.save(b.id)
    } catch (err) {
      if (err instanceof DiskChangedError || err instanceof ControlCharsError) {
        changedOnDisk.push(b.relPath)
        continue
      }
      ws.notify(`Save failed for ${b.relPath}: ${(err as Error).message}`, "error")
      return false
    }
  }
  if (changedOnDisk.length) {
    ws.notify(`Not saved, needs a decision first (Ctrl+S in each): ${changedOnDisk.join(", ")}`, "warn")
    return false
  }
  return true
}

/** Text the edit commands act on: the selection, or the whole current line (VS Code style). */
function selectionOrLine(ws: Workspace): { text: string; wholeLine: boolean } | null {
  const ta = ws.buffers.active?.textarea
  if (!ta) return null
  if (ta.hasSelection()) return { text: ta.getSelectedText(), wholeLine: false }
  const row = ta.logicalCursor.row
  const line = lineAt(ta, row)
  return { text: line + "\n", wholeLine: true }
}

function selectCurrentLine(ws: Workspace): void {
  const ta = ws.buffers.active?.textarea
  if (!ta) return
  const eb = ta.editBuffer
  const row = ta.logicalCursor.row
  const start = eb.getLineStartOffset(row)
  const end = row + 1 < ta.lineCount ? eb.getLineStartOffset(row + 1) : eb.positionToOffset(row, Bun.stringWidth(lineAt(ta, row)))
  ta.setSelection(start, end)
}

export async function copySelection(ws: Workspace, opts: { quiet?: boolean } = {}): Promise<void> {
  const sel = selectionOrLine(ws)
  if (!sel || sel.text.length === 0) return
  const how = await ws.clipboard.copy(sel.text)
  if (!opts.quiet) {
    const what = sel.wholeLine ? "line" : `${sel.text.length} chars`
    ws.notify(how === "internal" ? `Copied ${what} (editor only: no system clipboard found)` : `Copied ${what}`)
  }
}

async function cutSelection(ws: Workspace): Promise<void> {
  const buf = ws.buffers.active
  const ta = buf?.textarea
  if (!buf || !ta) return
  const sel = selectionOrLine(ws)
  if (!sel) return
  await ws.clipboard.copy(sel.text)
  if (sel.wholeLine) selectCurrentLine(ws)
  ta.deleteSelection()
  ws.buffers.onContentChange(buf.id)
}

async function pasteClipboard(ws: Workspace): Promise<void> {
  const buf = ws.buffers.active
  const ta = buf?.textarea
  if (!buf || !ta) return
  const raw = await ws.clipboard.paste()
  if (raw === null) return ws.notify("Clipboard is empty", "warn")
  const { text } = decodeForBuffer(raw)
  if (multiPaste(ws, text)) return
  if (ta.hasSelection()) ta.deleteSelection()
  ta.insertText(text)
  ws.buffers.onContentChange(buf.id)
}

function historyStep(ws: Workspace, dir: "undo" | "redo"): void {
  const buf = ws.buffers.active
  if (!buf?.textarea) return
  if (dir === "undo") buf.textarea.undo()
  else buf.textarea.redo() // the editor reports both as a content change
}

/**
 * 1-based last line of a selection starting on 0-based `startRow`. A selection
 * ending right after a newline (whole lines picked with Shift+Down) does not
 * include the line it ends on.
 */
export function selectionLineSpan(startRow: number, text: string): { end: number; text: string } {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text
  const newlines = body.split("\n").length - 1
  return { end: startRow + 1 + newlines, text }
}

/** Close a tab, asking first when it has unsaved changes. */
export function closeBuffer(ws: Workspace, id: number): void {
  const buf = ws.buffers.byId(id)
  if (!buf) return
  if (!buf.dirty) return ws.buffers.close(buf.id)
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: "Close tab",
      body: `${buf.relPath} has unsaved changes.`,
      options: [
        {
          key: "s",
          label: "Save and close",
          run: async () => {
            closeModal(ws)
            await ws.buffers.save(buf.id)
            ws.buffers.close(buf.id)
          },
        },
        { key: "d", label: "Discard", run: () => (closeModal(ws), ws.buffers.close(buf.id)) },
        { key: "c", label: "Cancel", run: () => closeModal(ws) },
      ],
    },
  })
}

/**
 * Ctrl+Alt+F: the SEARCH tab of the left pane, seeded with the selection or the word under the
 * cursor. A terminal too narrow for the pane gets the popup instead.
 */
function openSearch(ws: Workspace, replace: boolean): void {
  const ui = ws.ui.get()
  if ((process.stdout.columns ?? Infinity) < 100) return ws.ui.set({ modal: { kind: "search", replace } })
  const ed = ui.focus === "editor" ? (ws.buffers.active?.textarea as CodeEditorRenderable | null | undefined) : null
  const sel = ed ? (ed.hasSelection() ? ed.getSelectedText() : wordUnderCursor(ed)) : ""
  ws.ui.set({
    sidebar: "search",
    treeVisible: true,
    focus: "tree",
    find: ui.find ? { ...ui.find, active: false } : null,
    searchSeed: { n: (ui.searchSeed?.n ?? 0) + 1, replace, text: sel.includes("\n") ? "" : sel },
  })
}

/**
 * Repository actions started from the editor (not from Source Control's repository tabs) go to
 * the open file's repository, as in VS Code. Returns whether there is one to act on.
 */
function followFile(ws: Workspace): boolean {
  ws.git?.pick(null)
  return !!ws.git?.repo
}

/** A menu of the project's repositories (branch, changed files) above the status bar; one opens in Source control. */
function pickRepo(ws: Workspace): void {
  const all = ws.git?.list() ?? []
  if (!all.length) return ws.notify("Not a git repository", "warn")
  if (all.length === 1) return void runCommand(ws, "git.changes")
  const names = all.map((s) => ws.git!.name(s))
  const nameW = Math.max(...names.map((n) => n.length))
  const items = all.map((s, i) => {
    const b = s.branch
    const branch = !b
      ? ""
      : b.detached
        ? `${b.name} (detached)`
        : `${b.name}${b.ahead ? ` ↑${b.ahead}` : ""}${b.behind ? ` ↓${b.behind}` : ""}`
    return {
      label: `${names[i]!.padEnd(nameW)}  ${branch}`,
      hint: s.entries.length ? `● ${s.entries.length}` : "",
      run: () => {
        ws.git!.pick(s.repo!.top)
        ws.ui.set({ modal: { kind: "scm" } })
      },
    }
  })
  ws.ui.set({ modal: { kind: "menu", x: 1, y: -2, items } })
}

function setFocus(ws: Workspace, focus: "tree" | "editor" | "ai"): void {
  const ui = ws.ui.get()
  // From the SEARCH tab, focusing the tree switches to FILES (as VS Code's Ctrl+Shift+E).
  if (focus === "tree" && ui.focus === "tree" && ui.sidebar === "search") return ws.ui.set({ sidebar: "files" })
  // "Maximize AI" hid the editor: Ctrl+E brings it back when it has tabs to show.
  const max = ui.aiMaximized
  const showEditor =
    focus === "editor" && max && !max.editor && ws.buffers.list().length
      ? { aiMaximized: { ...max, editor: true }, notice: null }
      : {}
  ws.ui.set({
    focus,
    ...showEditor,
    ...(focus === "tree" ? { sidebar: "files" as const } : {}),
    treeVisible: focus === "tree" ? true : ui.treeVisible,
    aiVisible: focus === "ai" ? true : ui.aiVisible,
  })
  if (focus === "ai") ws.ai?.focus()
}

/** Open another project folder (Open Recent Folder): a restart into it, asking first about unsaved changes. */
export function switchFolder(ws: Workspace, folder: string): void {
  leave(ws, "restart", folder)
}

/** Quit or restart (in this folder, or into `folder`), asking first when there are unsaved changes. */
function leave(ws: Workspace, how: "quit" | "restart", folder?: string): void {
  const go = () => {
    if (how === "quit") return void shutdown(0)
    if (folder) return void restart({ files: [], active: null, root: folder })
    const files = ws.buffers.list().map((b) => b.path)
    void restart({ files, active: ws.buffers.active?.path ?? null, root: ws.root, ai: ws.agents?.snapshot() })
  }
  if (!ws.buffers.hasDirty()) return go()
  const n = ws.buffers.list().filter((b) => b.dirty).length
  const verb = how === "quit" ? "quit" : folder ? `open ${basename(folder)}` : "restart"
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: "Unsaved changes",
      body: `${n} file${n === 1 ? " has" : "s have"} unsaved changes.`,
      options: [
        { key: "s", label: `Save all and ${verb}`, run: async () => void ((await saveAll(ws)) && go()) },
        { key: "d", label: `Discard and ${verb}`, run: go },
        { key: "c", label: "Cancel", run: () => closeModal(ws) },
      ],
    },
  })
}

export const AI_ASK = {
  explain: "Explain what this code does and anything surprising about it.",
  fix: "Find bugs in this code and fix them. Keep the change minimal and explain it.",
  tests: "Write tests for this code next to the existing tests, then run them.",
}

/**
 * Put the current file, or the selected lines, into the AI prompt (Ctrl+L). With an
 * instruction, add it and submit, so a menu click becomes one finished request.
 */
function sendContext(ws: Workspace, instruction?: string): void {
  const buf = ws.buffers.active
  if (!buf) return ws.notify("No file open", "warn")
  const ai = ws.ai
  if (!ai) return ws.notify("AI terminal is not running", "warn")
  const ta = buf.textarea
  const selection = ta?.hasSelection() ? ta.getSelection() : null
  let range: { start: number; end: number; text: string } | null = null
  if (ta && selection) {
    const text = ta.getSelectedText()
    const startRow = ta.editBuffer.offsetToPosition(selection.start)?.row ?? 0
    range = { start: startRow + 1, ...selectionLineSpan(startRow, text) }
  }
  // A preview sends the Markdown file it shows.
  const { reference, snippet } = formatContextForAgent(relative(ws.root, buf.source ?? buf.path), range)
  ai.type(reference)
  if (snippet) ai.paste(snippet)
  setFocus(ws, "ai")
  if (instruction) {
    ai.type(" " + instruction)
    // Give the CLI a moment to take the paste before Enter.
    setTimeout(() => ai.submit(), 150)
  }
}

export const commands = {
  "app.quit": { title: "Quit", run: (ws) => leave(ws, "quit") },
  "app.restart": { title: "Restart (load a newly installed version)", run: (ws) => leave(ws, "restart") },
  "file.openRecent": { title: "Open recent folder…", run: (ws) => ws.ui.set({ modal: { kind: "recent" } }) },
  "app.reportProblem": { title: "Report a problem (the AI drafts a GitHub issue)", run: (ws) => reportProblem(ws) },
  "app.installUpdate": {
    title: "Install the latest copane release",
    run: async (ws) => {
      if (!isCompiled()) return ws.notify("Running from source: update with git pull, then bun run install:cli", "warn")
      const { latestRelease, installRelease, isNewer } = await import("../setup/upgrade")
      ws.notify("Checking for a new release…")
      const tag = await latestRelease()
      if (!isNewer(tag, pkg.version)) {
        ws.ui.set({ updateAvailable: null })
        return ws.notify(`copane ${pkg.version} is up to date`)
      }
      ws.notify(`Installing copane ${tag}…`)
      await installRelease(tag)
      // The binary watcher now shows "Update installed: restart".
      ws.ui.set({ updateAvailable: null })
    },
  },
  "file.save": { title: "Save file", run: saveActive },
  "file.saveAll": { title: "Save all files", run: async (ws) => void (await saveAll(ws)) },
  "file.picker": { title: "Go to file", run: (ws) => ws.ui.set({ modal: { kind: "picker" } }) },
  "file.symbolInFile": { title: "Go to symbol in file", run: (ws) => ws.ui.set({ modal: { kind: "picker", query: "@" } }) },
  "file.symbolInProject": { title: "Go to symbol in project", run: (ws) => ws.ui.set({ modal: { kind: "picker", query: "#" } }) },
  "focus.tree": { title: "Focus file tree", run: (ws) => setFocus(ws, "tree") },
  "view.toggleSidebar": {
    title: "Show / hide the sidebar (file tree)",
    run(ws) {
      const ui = ws.ui.get()
      // Hidden: show it with the tree focused. Shown: hide it, as VS Code's Ctrl+B does.
      if (!ui.treeVisible) return setFocus(ws, "tree")
      ws.ui.set({ treeVisible: false, focus: ui.focus === "tree" ? "editor" : ui.focus })
    },
  },
  "focus.editor": { title: "Focus editor", run: (ws) => setFocus(ws, "editor") },
  "focus.ai": { title: "Focus AI terminal", run: (ws) => setFocus(ws, "ai") },
  "find.open": { title: "Find in file (again: toggle replace)", run: (ws) => openFind(ws, false) },
  "find.replace": { title: "Find and replace", run: (ws) => openFind(ws, true) },
  "edit.gotoLine": {
    title: "Go to line[:column]",
    run(ws) {
      const buf = ws.buffers.active
      const ed = buf?.textarea as CodeEditorRenderable | null | undefined
      if (!buf || !ed) return ws.notify("No file open", "warn")
      ws.ui.set({
        modal: {
          kind: "prompt",
          title: "Go to line",
          label: `Line[:column], 1–${ed.lineCount} (now ${buf.cursor.row + 1})`,
          initial: "",
          submit: async (value) => {
            const r = parseGoto(value, ed.lineCount)
            if (typeof r === "string") return r
            ws.ui.set({ modal: null, focus: "editor" })
            recordJump(ws)
            ed.goTo(r.row, r.col)
            ws.buffers.onCursorChange(buf.id)
            return null
          },
        },
      })
    },
  },
  "edit.addOccurrence": { title: "Add next occurrence (multi-cursor)", run: (ws) => addNextOccurrence(ws) },
  "edit.allOccurrences": { title: "Select all occurrences (multi-cursor)", run: (ws) => selectAllOccurrences(ws) },
  "lsp.complete": { title: "Suggest completions", run: () => completeNow() },
  "lsp.hover": { title: "Show type info / docs under the cursor", run: (ws) => showHover(ws) },
  "lsp.definition": { title: "Go to definition", run: (ws) => goToDefinition(ws) },
  "lsp.nextProblem": { title: "Next problem in this file", run: (ws) => nextProblem(ws) },
  "lsp.rename": { title: "Rename symbol (all files)", run: (ws) => renameSymbol(ws) },
  "lsp.quickFix": { title: "Quick fix… (code actions at the cursor)", run: (ws) => quickFix(ws) },
  "lsp.organizeImports": { title: "Organize imports", run: (ws) => organizeImports(ws) },
  "lsp.references": { title: "Find all references", run: (ws) => findReferences(ws) },
  "lsp.format": { title: "Format document", run: (ws) => formatDocument(ws) },
  "lsp.problems": { title: "Problems (errors and warnings)", run: (ws) => ws.ui.set({ modal: { kind: "problems" } }) },
  "git.peekHunk": {
    title: "Show the change at the cursor (stage / revert)",
    run(ws) {
      const buf = ws.buffers.active
      if (!buf?.textarea) return ws.notify("No file open", "warn")
      ws.ui.set({ hunkPeek: { bufId: buf.id, row: buf.textarea.logicalCursor.row } })
    },
  },
  // Conflicts come first: while a file has them, Alt+F5 / Shift+Alt+F5 step through those.
  "git.nextChange": {
    title: "Next change (or merge conflict) in file",
    run: (ws) => void (gotoConflict(ws, 1) || gotoChange(ws, 1)),
  },
  "git.prevChange": {
    title: "Previous change (or merge conflict) in file",
    run: (ws) => void (gotoConflict(ws, -1) || gotoChange(ws, -1)),
  },
  "conflict.acceptCurrent": { title: "Merge conflict: accept current", run: (ws) => acceptConflict(ws, "current") },
  "conflict.acceptIncoming": { title: "Merge conflict: accept incoming", run: (ws) => acceptConflict(ws, "incoming") },
  "conflict.acceptBoth": { title: "Merge conflict: accept both", run: (ws) => acceptConflict(ws, "both") },
  "git.branches": {
    title: "Switch or create a branch",
    run: (ws) => (followFile(ws) ? ws.ui.set({ modal: { kind: "branches" } }) : ws.notify("Not a git repository", "warn")),
  },
  "git.deleteBranch": {
    title: "Delete a branch",
    run: (ws) =>
      followFile(ws) ? ws.ui.set({ modal: { kind: "branches", mode: "delete" } }) : ws.notify("Not a git repository", "warn"),
  },
  "git.stageHunk": {
    title: "Stage the change at the cursor",
    run: async (ws) => {
      const row = ws.buffers.active?.textarea?.logicalCursor.row ?? 0
      const err = await stageHunk(ws, row)
      ws.notify(err ?? "Staged this change", err ? "error" : "info")
    },
  },
  "git.revertHunk": {
    title: "Revert the change at the cursor",
    run: async (ws) => {
      const row = ws.buffers.active?.textarea?.logicalCursor.row ?? 0
      const err = await revertHunkAt(ws, row)
      if (err) ws.notify(err, "error")
    },
  },
  "nav.back": { title: "Go back (previous location)", run: (ws) => navigateBack(ws) },
  "nav.forward": { title: "Go forward", run: (ws) => navigateForward(ws) },
  "git.fileHistory": {
    title: "File history (git log)",
    run(ws) {
      const buf = ws.buffers.active
      const path = buf ? (buf.source ?? buf.path) : null
      if (!(path ? ws.git?.for(path) : followFile(ws))) return ws.notify("Not a git repository", "warn")
      ws.ui.set({ modal: { kind: "history", path } })
    },
  },
  "git.history": {
    title: "Commit history (git log of the whole project)",
    run: (ws) =>
      followFile(ws) ? ws.ui.set({ modal: { kind: "history", path: null } }) : ws.notify("Not a git repository", "warn"),
  },
  "git.blameLine": {
    title: "Show the commit that last changed this line",
    run: async (ws) => {
      const buf = ws.buffers.active
      if (!buf || !ws.git?.for(buf.path)) return ws.notify("Not a git repository", "warn")
      const lines = await blameFor(ws, buf.path, ws.buffers.textOf(buf), `${buf.id}:${buf.version}`)
      const b = lines[buf.cursor.row]
      if (!b || b.sha === NOT_COMMITTED) return ws.notify("This line is not committed yet")
      ws.ui.set({ modal: { kind: "history", path: buf.path, sha: b.sha } })
    },
  },
  "git.changes": {
    title: "Source control: stage, commit, push",
    run: (ws) => {
      followFile(ws)
      ws.ui.set({ modal: { kind: "scm" } })
    },
  },
  "git.pickRepo": { title: "Source control: choose repository", run: (ws) => pickRepo(ws) },
  "search.files": { title: "Search in all files", run: (ws) => openSearch(ws, false) },
  "search.replace": { title: "Replace in all files", run: (ws) => openSearch(ws, true) },
  "git.toggleFileBlame": {
    title: "Toggle file blame (who changed each line, as in GitLens)",
    run(ws) {
      if (!ws.git?.enabled) return ws.notify("Not a git repository", "warn")
      const on = !ws.ui.get().fileBlame
      ws.ui.set({ fileBlame: on })
      ws.notify(
        on
          ? `File blame on: click a block for its commit (${macKeys(ws.config) ? "Alt+Shift+B" : "Alt+B"} hides it)`
          : "File blame off",
      )
    },
  },
  "view.wordWrap": {
    title: "Toggle word wrap",
    run(ws) {
      const on = !ws.ui.get().wordWrap
      ws.ui.set({ wordWrap: on })
      ws.notify(on ? "Word wrap on" : "Word wrap off")
    },
  },
  "view.toggleResources": {
    title: "Toggle resource usage (CPU / memory) in the status bar",
    run(ws) {
      const on = !(ws.ui.get().resources ?? ws.config.statusBar.resources)
      ws.ui.set({ resources: on })
      const keep = on === ws.config.statusBar.resources ? "" : ` for this session (statusBar.resources: ${on} keeps it)`
      ws.notify(`Resource usage ${on ? "on" : "off"}${keep}`)
    },
  },
  "view.toggleAi": {
    title: "Show / hide the AI pane",
    run(ws) {
      const ui = ws.ui.get()
      const show = !ui.aiVisible
      // Hiding the AI pane ends "maximize AI" too, bringing back the tree it hid.
      const tree = !show && ui.aiMaximized ? { treeVisible: ui.aiMaximized.tree, aiMaximized: null } : {}
      ws.ui.set({ aiVisible: show, maximized: null, ...tree, focus: show ? ui.focus : ui.focus === "ai" ? "editor" : ui.focus })
      if (show && ui.focus === "ai") ws.ai?.focus()
    },
  },
  "view.maximizeEditor": {
    title: "Maximize editor (hide tree and AI) / restore",
    run(ws) {
      const ui = ws.ui.get()
      if (ui.maximized) {
        ws.ui.set({ treeVisible: ui.maximized.tree, aiVisible: ui.maximized.ai, maximized: null })
      } else {
        // From "maximize AI", restoring later brings back the tree as it was before that.
        const tree = ui.aiMaximized ? ui.aiMaximized.tree : ui.treeVisible
        ws.ui.set({
          maximized: { tree, ai: ui.aiVisible },
          aiMaximized: null,
          treeVisible: false,
          aiVisible: false,
          focus: "editor",
        })
      }
    },
  },
  "view.maximizeAi": {
    title: "Maximize AI pane: hide the editor (Ctrl+E shows it) / restore",
    run(ws) {
      const ui = ws.ui.get()
      const max = ui.aiMaximized
      // The editor was shown with Ctrl+E: hide it again. Already hidden: restore the layout.
      if (max && !(max.editor && ws.buffers.list().length)) return ws.ui.set({ treeVisible: max.tree, aiMaximized: null })
      const tree = max ? max.tree : ui.maximized ? ui.maximized.tree : ui.treeVisible
      ws.ui.set({ aiMaximized: { tree, editor: false }, maximized: null, treeVisible: false, aiVisible: true, focus: "ai" })
      ws.ai?.focus()
    },
  },
  "file.revealInOS": {
    title: "Reveal in file manager (Explorer / Finder)",
    async run(ws) {
      const buf = ws.buffers.active
      const path = buf ? (buf.source ?? buf.path) : ws.root
      const err = await revealInFileManager(path, !buf)
      if (err) ws.notify(`Could not reveal: ${err}`, "error")
    },
  },
  "markdown.openPreview": { title: "Markdown: open preview / back to the source", run: openPreview },
  "markdown.togglePreviewSide": {
    title: "Markdown: open preview to the side",
    run(ws) {
      const on = !ws.ui.get().mdSide
      if (on && ws.buffers.active?.filetype !== "markdown") return ws.notify("Not a Markdown file")
      ws.ui.set({ mdSide: on })
    },
  },
  "buffer.next": { title: "Next tab", run: (ws) => ws.buffers.cycle(1) },
  "buffer.reopenClosed": { title: "Reopen closed tab", run: reopenClosed },
  "buffer.goto1": { title: "Go to tab 1", run: (ws) => altNumber(ws, 1) },
  "buffer.goto2": { title: "Go to tab 2", run: (ws) => altNumber(ws, 2) },
  "buffer.goto3": { title: "Go to tab 3", run: (ws) => altNumber(ws, 3) },
  "buffer.goto4": { title: "Go to tab 4", run: (ws) => altNumber(ws, 4) },
  "buffer.goto5": { title: "Go to tab 5", run: (ws) => altNumber(ws, 5) },
  "buffer.goto6": { title: "Go to tab 6", run: (ws) => altNumber(ws, 6) },
  "buffer.goto7": { title: "Go to tab 7", run: (ws) => altNumber(ws, 7) },
  "buffer.goto8": { title: "Go to tab 8", run: (ws) => altNumber(ws, 8) },
  "buffer.goto9": { title: "Go to the last tab", run: (ws) => altNumber(ws, 9) },
  "buffer.prev": { title: "Previous tab", run: (ws) => ws.buffers.cycle(-1) },
  "buffer.close": {
    title: "Close tab",
    run(ws) {
      const buf = ws.buffers.active
      if (buf) closeBuffer(ws, buf.id)
    },
  },
  "buffer.reloadFromDisk": {
    title: "Reload file from disk",
    run: async (ws) => {
      const b = ws.buffers.active
      if (b && (await ws.buffers.reloadFromDisk(b.id)) === "gone")
        ws.notify("The file is no longer on disk; your version is kept", "warn")
    },
  },
  "buffer.keepLocal": {
    title: "Keep local changes",
    run: (ws) => {
      const b = ws.buffers.active
      if (b) ws.buffers.keepLocal(b.id)
    },
  },
  "edit.copy": { title: "Copy", run: (ws) => copySelection(ws) },
  "edit.cut": { title: "Cut", run: cutSelection },
  "edit.paste": { title: "Paste", run: pasteClipboard },
  "edit.selectAll": {
    title: "Select all",
    run: (ws) => {
      const ta = ws.buffers.active?.textarea
      ta?.selectAll()
      if (ta) ws.buffers.onCursorChange(ws.buffers.active!.id)
    },
  },
  // Mac: Cmd+←/→ (sent as Ctrl+A / Ctrl+E by Ghostty and iTerm2).
  "edit.lineStart": { title: "Move cursor to line start", run: (ws) => lineEdge(ws, -1) },
  "edit.lineEnd": { title: "Move cursor to line end", run: (ws) => lineEdge(ws, 1) },
  "edit.toggleComment": { title: "Toggle line comment", run: (ws) => toggleLineComment(ws) },
  "edit.addComment": { title: "Add line comment", run: (ws) => toggleLineComment(ws, "add") },
  "edit.removeComment": { title: "Remove line comment", run: (ws) => toggleLineComment(ws, "remove") },
  "edit.trimWhitespace": { title: "Trim trailing whitespace", run: trimWhitespace },
  "edit.moveLineUp": { title: "Move line up", run: (ws) => moveLine(ws, -1) },
  "edit.moveLineDown": { title: "Move line down", run: (ws) => moveLine(ws, 1) },
  "edit.duplicateLineUp": { title: "Duplicate line (copy up)", run: (ws) => duplicateLine(ws, -1) },
  "edit.duplicateLineDown": { title: "Duplicate line (copy down)", run: (ws) => duplicateLine(ws, 1) },
  "edit.deleteLine": { title: "Delete line", run: deleteLine },
  "edit.indent": { title: "Indent", run: (ws) => indent(ws) },
  "edit.indentLine": { title: "Indent line", run: (ws) => indent(ws, true) },
  "edit.outdent": { title: "Outdent", run: outdent },
  "edit.undo": { title: "Undo", run: (ws) => historyStep(ws, "undo") },
  "edit.redo": { title: "Redo", run: (ws) => historyStep(ws, "redo") },
  "app.palette": { title: "Command palette", run: (ws) => ws.ui.set({ modal: { kind: "palette" } }) },
  "app.openConfig": { title: "Open settings (JSON)", run: openConfig },
  "app.importVSCode": { title: "Import VS Code settings (word wrap, format on save, ...)", run: importVSCode },
  "app.help": { title: "Keyboard shortcuts", run: (ws) => ws.ui.set({ modal: { kind: "help" } }) },
  "ai.sendContext": { title: "Send file / selection to AI", run: (ws) => sendContext(ws) },
  "ai.explain": { title: "AI: explain this code", run: (ws) => sendContext(ws, AI_ASK.explain) },
  "ai.fix": { title: "AI: find and fix bugs here", run: (ws) => sendContext(ws, AI_ASK.fix) },
  "ai.tests": { title: "AI: write tests for this", run: (ws) => sendContext(ws, AI_ASK.tests) },
  "ai.newAgent": { title: "AI: new agent tab (another CLI, or one in a git worktree)", run: (ws) => ws.agents?.openMenu() },
  "ai.nextAgent": { title: "AI: next agent tab", run: (ws) => ws.agents?.cycle(1) },
  "ai.prevAgent": { title: "AI: previous agent tab", run: (ws) => ws.agents?.cycle(-1) },
  "ai.closeAgent": { title: "AI: close this agent tab", run: (ws) => ws.agents?.closeActive() },
  "ai.copySelection": {
    title: "AI pane: copy the selected text",
    run: (ws) => {
      if (!ws.agents?.copySelection()) ws.notify("Nothing selected: drag in the AI pane to select")
    },
  },
  "ai.turns": { title: "AI turns: review and undo what the AI changed", run: (ws) => ws.ui.set({ modal: { kind: "turns" } }) },
  "ai.newTerminal": { title: "Terminal: new terminal tab (your shell, in the AI pane)", run: (ws) => ws.agents?.newTerminal() },
  "ai.run": { title: "Terminal: run a dev server (npm run dev, docker compose up…)", run: (ws) => ws.agents?.openRun() },
  "ai.fixTerminalError": {
    title: "AI: fix the terminal error (send a terminal's error to the AI)",
    run: (ws) => void ws.agents?.sendTerminalError(),
  },
  "ai.fixProblems": { title: "AI: fix problems (this file's errors, else all open files')", run: (ws) => sendProblems(ws) },
  "ai.reviewChanges": { title: "AI: review my changes (the git diff)", run: sendChangesForReview },
  "ai.nextChange": { title: "AI edits: next unreviewed change (accept / undo)", run: (ws) => void stepAiChange(ws, 1) },
  "ai.prevChange": { title: "AI edits: previous unreviewed change", run: (ws) => void stepAiChange(ws, -1) },
  "ai.acceptChange": {
    title: "AI edits: accept the change at the cursor",
    run: (ws) => {
      const err = acceptAiChangeAt(ws, ws.buffers.active?.textarea?.logicalCursor.row ?? 0)
      if (err) ws.notify(err, "warn")
    },
  },
  "ai.undoChange": {
    title: "AI edits: undo the change at the cursor",
    run: (ws) => {
      const err = undoAiChangeAt(ws, ws.buffers.active?.textarea?.logicalCursor.row ?? 0)
      ws.notify(err ?? "Undid this AI change (Ctrl+Z brings it back)", err ? "warn" : "info")
    },
  },
  "ai.acceptFile": {
    title: "AI edits: accept all changes in this file",
    run: (ws) => {
      const buf = ws.buffers.active
      if (!buf || !ws.review?.has(buf.path)) return ws.notify("No AI changes in this file", "warn")
      ws.review.acceptFile(buf.path)
      ws.notify(`Accepted the AI changes in ${buf.relPath}`)
    },
  },
  "ai.undoFile": {
    title: "AI edits: undo all changes in this file",
    run: (ws) => {
      const err = undoAiFile(ws)
      ws.notify(err ?? "Undid the AI changes in this file (Ctrl+Z brings them back)", err ? "warn" : "info")
    },
  },
  "ai.mergeAgent": {
    title: "AI: review & merge this agent's worktree",
    run: (ws) => {
      const id = ws.agents?.activeId()
      if (id === undefined || !ws.agents?.session(id)?.branch)
        return ws.notify("The visible agent doesn't work in its own worktree (Ctrl+Alt+N › … in a git worktree)", "warn")
      ws.ui.set({ modal: { kind: "mergeAgent", sessionId: id } })
    },
  },
  "ai.acceptAll": {
    title: "AI edits: accept everything (all files)",
    run: (ws) => {
      if (!ws.review?.files().length) return ws.notify("No AI changes to review")
      ws.review.acceptAll()
      ws.notify("Accepted all AI changes")
    },
  },
} satisfies Record<string, Command>

/** Alt+N / Alt+P: go to the next AI change and open its peek. */
async function stepAiChange(ws: Workspace, dir: 1 | -1): Promise<void> {
  const at = await gotoAiChange(ws, dir)
  // From the AI pane or the tree too: the review happens in the editor.
  if (at) ws.ui.set({ focus: "editor", hunkPeek: { ...at, kind: "ai" } })
}

export type CommandId = keyof typeof commands

function lineEdge(ws: Workspace, dir: -1 | 1): void {
  const buf = ws.buffers.active
  const ta = buf?.textarea
  if (!buf || !ta) return
  const edge = (ta as { gotoLineEdge?: (dir: -1 | 1) => void }).gotoLineEdge
  if (edge) edge.call(ta, dir)
  else if (dir < 0) ta.gotoLineHome()
  else ta.gotoLineEnd()
  ws.buffers.onCursorChange(buf.id)
}

export async function runCommand(ws: Workspace, id: CommandId): Promise<void> {
  try {
    await commands[id].run(ws)
  } catch (err) {
    if (err instanceof BinaryFileError) ws.notify(err.message, "warn")
    else ws.notify(`${commands[id].title} failed: ${(err as Error).message}`, "error")
  }
}
