import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { basename, dirname } from "node:path"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { HoverBox, Modal } from "../app/Modal"
import { useUi, useWorkspace, type Workspace, useCursorStyle } from "../app/workspace"
import { diffColors, ui as colors } from "../config/theme"
import { filetypeOf } from "../editor/grammars"
import { useSyntaxStyle } from "../editor/syntaxStyle"
import { openAt } from "../app/navHistory"
import type { StatusEntry } from "./repo"
import { sendChangesForReview } from "../ai/askAi"
import { aiMarks } from "../ai/review"
import { setGitActivity, useGitActivity, useSpinner, type GitActivity } from "./activity"
import { closeModal, openOver } from "../app/modalStack"
import { keyText } from "../keymap/keys"
import { keyStyleOf } from "../keymap/platform"

/**
 * Source control (Ctrl+Alt+D): conflicts, staged and unstaged files with a diff of the
 * selection, a commit message, commit / amend / AI message, push / pull, branch switch.
 * In the diff, single changes (hunks) can be staged, unstaged or discarded. A project with several
 * repositories gets a tab per repository (VS Code's REPOSITORIES); everything acts on the one shown.
 */

const none = { subscribe: () => () => {}, getSnapshot: () => 0 }
/** The message being written survives closing the panel. */
let draft = ""
/** So does the selected file (a menu item that leaves the panel opens it again). */
let lastCursor: Cursor | null = null
/** Tests: no message or selection left over from another test. */
export function resetCommitDraft(): void {
  draft = ""
  lastCursor = null
}

type Section = "conflict" | "staged" | "changes"
interface Row {
  section: Section
  entry: StatusEntry
}
/** The selection: a file in a section, and where it was, for when the file moves away. */
interface Cursor {
  key: string
  section: Section
  pos: number
  idx: number
}
type Focus = "list" | "message" | "diff"

const keyOf = (r: Row) => `${r.section}:${r.entry.path}`

const LETTER = (e: StatusEntry, section: Section) => {
  if (section === "conflict") return "!"
  if (e.untracked) return "U"
  const c = section === "staged" ? e.x : e.y
  return c === "?" ? "U" : c
}
const letterColor = (l: string) => (l === "M" ? colors.warn : l === "D" || l === "!" ? colors.error : colors.ok)

/** The 0-based line of the first added line in a diff (where Enter opens the file), or 0. */
export function firstAddedLine(raw: string): number {
  let n = 0
  for (const l of raw.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l)
    if (h) n = Number(h[1]) - 1
    else if (l.startsWith("+")) return n
    else if (l.startsWith(" ")) n++
  }
  return 0
}

/** The hunks of a diff: their text (for `git apply`). */
export function diffHunks(raw: string): { text: string }[] {
  const out: { text: string }[] = []
  let cur: string[] | null = null
  for (const l of raw.split("\n")) {
    if (l.startsWith("@@")) {
      if (cur) out.at(-1)!.text = cur.join("\n")
      cur = [l]
      out.push({ text: "" })
    } else if (cur && /^([ +\-\\]|$)/.test(l)) cur.push(l)
    else if (cur) {
      // Not diff content (the "diff cut" note): the hunk ends here.
      out.at(-1)!.text = cur.join("\n")
      cur = null
    }
  }
  if (cur) out.at(-1)!.text = cur.join("\n").replace(/\n+$/, "")
  return out
}

/** Ask the AI CLI (`claude -p`) for a commit message from the staged diff. */
export async function aiCommitMessage(ws: Workspace): Promise<string | { error: string }> {
  const cmd = ws.config.ai.command
  if (!ws.config.git.aiCommitMessage) return { error: "AI commit messages are off (git.aiCommitMessage)" }
  if (basename(cmd) !== "claude") return { error: `AI messages need claude as ai.command (now ${cmd})` }
  const repo = ws.git!.repo!
  const diff = await repo.stagedDiff()
  if (!diff.trim()) return { error: "Stage something first" }
  const prompt =
    "Write a git commit message for the staged diff on stdin. First line: imperative summary under 72 characters. " +
    "Then a blank line and a few short lines only if the change needs explaining. Output only the message, no quotes or code fences."
  try {
    const p = Bun.spawn([cmd, "-p", prompt], {
      cwd: repo.top,
      stdin: new TextEncoder().encode(diff),
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => p.kill(), 90_000)
    const [out, code] = await Promise.all([Bun.readableStreamToText(p.stdout), p.exited])
    clearTimeout(timer)
    const msg = out
      .trim()
      .replace(/^```\w*\n?|```$/g, "")
      .trim()
    return code === 0 && msg ? msg : { error: "The AI did not return a message" }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/** How many rows a row of buttons (label plus padding, one apart) wraps to in `width`. */
function wrappedRows(labels: string[], width: number): number {
  let rows = 1
  let x = 0
  for (const l of labels) {
    const w = l.length + 2
    if (x > 0 && x + 1 + w > width) {
      rows++
      x = w
    } else x += (x > 0 ? 1 : 0) + w
  }
  return rows
}

export function SourceControlPanel() {
  const cursorStyle = useCursorStyle()
  const ws = useWorkspace()
  // Under its own menu or a dialog opened from it, the panel stays on screen but not in charge of the keys.
  const onTop = useUi().modal?.kind === "scm"
  const repos = ws.git
  const dims = useTerminalDimensions()
  const snap = useSyncExternalStore(repos?.subscribe ?? none.subscribe, repos?.getSnapshot ?? none.getSnapshot)
  // The repository shown: picked with the tabs, else the open file's (see GitRepos.current).
  const git = repos?.current() ?? null
  const repo = git?.repo ?? null
  const all = repos?.list() ?? []
  useSyncExternalStore(
    ws.review?.store.subscribe ?? none.subscribe,
    ws.review ? () => ws.review!.store.get().version : none.getSnapshot,
  )
  const ai = aiMarks(ws)
  const entries = git?.entries ?? []
  const rows: Row[] = [
    ...entries.filter((e) => e.conflict).map((entry) => ({ section: "conflict" as const, entry })),
    ...entries.filter((e) => e.staged).map((entry) => ({ section: "staged" as const, entry })),
    ...entries.filter((e) => e.unstaged).map((entry) => ({ section: "changes" as const, entry })),
  ]
  const counts = { conflict: 0, staged: 0, changes: 0 }
  for (const r of rows) counts[r.section]++

  const [cursor, setCursor] = useState<Cursor | null>(lastCursor)
  const [focus, setFocus] = useState<Focus>(rows.some((r) => r.section === "staged") ? "message" : "list")
  const [message, setMessage] = useState(draft)
  const [inputKey, setInputKey] = useState(0)
  const [confirm, setConfirm] = useState<{ text: string; yes: () => void } | null>(null)
  const [rawDiff, setRawDiff] = useState("")
  const diffBox = useRef<ScrollBoxRenderable | null>(null)
  const syntaxStyle = useSyntaxStyle()
  const [hunkSel, setHunkSel] = useState(0)
  const [stats, setStats] = useState<{
    staged: Map<string, { add: number; del: number }>
    changes: Map<string, { add: number; del: number }>
  }>({
    staged: new Map(),
    changes: new Map(),
  })
  const [lastCommit, setLastCommit] = useState("")
  const msgRef = useRef<TextareaRenderable | null>(null)

  // The selected row: the same file if it is still in its section, otherwise the file that took
  // its place there (the next one, or the last), as VS Code does after staging.
  let sel = 0
  if (cursor && rows.length) {
    const at = rows.findIndex((r) => keyOf(r) === cursor.key)
    if (at >= 0) sel = at
    else {
      const same = rows.map((r, i) => [r, i] as const).filter(([r]) => r.section === cursor.section)
      sel = same.length ? same[Math.min(cursor.pos, same.length - 1)]![1] : Math.min(cursor.idx, rows.length - 1)
    }
  }
  const row = rows[sel]
  const select = (i: number) => {
    const r = rows[i]
    if (!r) return
    const c = { key: keyOf(r), section: r.section, pos: rows.slice(0, i).filter((x) => x.section === r.section).length, idx: i }
    lastCursor = c
    setCursor(c)
  }

  useEffect(() => {
    draft = message
  }, [message])

  // Shared with the status bar: a push or commit keeps going (and showing) when the panel closes.
  const status = useGitActivity()
  const spin = useSpinner(status?.kind === "busy")
  const setStatus = (st: GitActivity | null) => {
    // Finished while the panel is closed: say how it went (the status bar only shows progress).
    if (st && st.kind !== "busy" && ws.ui.get().modal?.kind !== "scm") {
      ws.notify(st.text, st.kind === "error" ? "error" : "info")
      return setGitActivity(null)
    }
    setGitActivity(st)
  }

  // Diff of the selected entry.
  useEffect(() => {
    let live = true
    if (diffBox.current) diffBox.current.scrollTop = 0
    setHunkSel(0)
    if (!row || !repo) return setRawDiff("")
    const staged = row.section === "staged"
    void repo
      .diff(row.entry.path, staged, row.entry.untracked && !staged)
      .then((d) => live && setRawDiff(d))
      .catch(() => live && setRawDiff(""))
    return () => {
      live = false
    }
  }, [row?.entry.path, row?.section, snap, repo])

  // Lines added and removed per file, and the last commit for the clean state.
  useEffect(() => {
    let live = true
    if (!repo) return
    void Promise.all([repo.numstat(true), repo.numstat(false), repo.lastMessage()])
      .then(([staged, changes, last]) => {
        if (!live) return
        setStats({ staged, changes })
        setLastCommit(last.split("\n")[0] ?? "")
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [snap, repo])

  const hunks = diffHunks(rawDiff)
  // The diff pane: each hunk is its @@ line, then a <diff> with a row per line ("\ No newline" has none).
  const hunkTops: number[] = []
  for (let r = 0, i = 0; i < hunks.length; i++) {
    hunkTops.push(r)
    r += hunks[i]!.text.split("\n").filter((l) => !l.startsWith("\\")).length
  }
  // Lines that aren't hunks: what git says instead (a binary or too big file), or the "diff cut" note.
  const notes = rawDiff.split("\n").filter((l) => (hunks.length ? l.startsWith("… diff cut") : l !== ""))

  const close = () => closeModal(ws)
  const showRepo = (i: number) => {
    const s = all[(i + all.length) % all.length]
    if (!s || s === git) return
    repos!.pick(s.repo!.top)
    lastCursor = null
    setCursor(null)
    setFocus(s.entries.some((e) => e.staged) ? "message" : "list")
  }
  const setMsg = (m: string) => {
    draft = m // the panel may have closed meanwhile (an AI message, a commit)
    setMessage(m)
    setInputKey((k) => k + 1) // remount the input with the new text
  }
  const busy = (text: string) => setStatus({ text, kind: "busy" })
  const fail = (text: string) => setStatus({ text, kind: "error" })
  const done = async (text: string) => {
    await git?.afterChange()
    setStatus({ text, kind: "info" })
  }

  const toggleStage = async (r: Row | undefined) => {
    if (!r || !repo) return
    const err = r.section === "staged" ? await repo.unstage([r.entry.path]) : await repo.stage([r.entry.path])
    if (err) return fail(err)
    await done(`${r.section === "staged" ? "Unstaged" : "Staged"} ${r.entry.rel}`)
  }
  const stageAll = async () => {
    if (!repo) return
    const err = await repo.stageAll()
    if (err) return fail(err)
    await done("Staged all changes")
  }
  const unstageAll = async () => {
    if (!repo || !counts.staged) return
    const err = await repo.unstageAll()
    if (err) return fail(err)
    await done("Unstaged all changes")
  }
  const discardAll = () => {
    if (!git || !counts.changes) return
    const list = rows.filter((r) => r.section === "changes")
    const fresh = list.filter((r) => r.entry.untracked).length
    const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`
    setConfirm({
      text: `Discard all changes in ${files(list.length)}${fresh ? ` (deletes ${fresh} new)` : ""}? (y/n)`,
      yes: async () => {
        busy("Discarding…")
        for (const r of list) {
          const err = await git.revert(r.entry.path)
          if (err) return fail(err)
        }
        await done(`Discarded changes in ${files(list.length)}`)
      },
    })
  }

  const commit = async (amend = false) => {
    if (!repo) return
    const msg = message.trim() || (amend ? await repo.lastMessage() : "")
    if (!msg) {
      setFocus("message")
      return fail("Write a commit message first")
    }
    if (!amend && counts.staged === 0) {
      if (counts.changes === 0) return fail("Nothing to commit")
      return setConfirm({
        text: "Nothing staged. Stage all changes and commit? (y/n)",
        yes: async () => {
          const err = await repo.stageAll()
          if (err) return fail(err)
          await finishCommit(msg, false)
        },
      })
    }
    await finishCommit(msg, amend)
  }
  const finishCommit = async (msg: string, amend: boolean) => {
    busy(amend ? "Amending…" : "Committing…")
    const r = await repo!.commit(msg, amend)
    if ("error" in r) return fail(r.error)
    setMsg("")
    await done(`${amend ? "Amended" : "Committed"} ${r.sha}`)
    ws.notify(`${amend ? "Amended" : "Committed"} ${r.sha}: ${msg.split("\n")[0]}`)
  }

  const push = async () => {
    if (!repo) return
    if (git?.branch?.detached) return fail("HEAD is detached: switch to a branch (b) to push")
    busy("Pushing…")
    const r = await repo.push((l) => busy(`Pushing… ${l}`))
    if ("ok" in r) return done("Pushed")
    if (r.noUpstream && git?.branch) {
      const branch = git.branch.name
      // The question needs the panel: closed meanwhile, say how to get it.
      if (ws.ui.get().modal?.kind !== "scm")
        return fail(`${branch} has no upstream yet: push from Source control (Ctrl+Alt+D) to publish it`)
      return setConfirm({
        text: `Branch ${branch} has no upstream. Publish it to the remote? (y/n)`,
        yes: async () => {
          busy("Publishing…")
          const err = await repo.pushSetUpstream(branch, (l) => busy(`Publishing… ${l}`))
          if (err) fail(err)
          else await done(`Published ${branch}`)
        },
      })
    }
    fail(r.error)
  }
  const pull = async () => {
    if (!repo) return
    busy("Pulling…")
    const err = await repo.pull((l) => busy(`Pulling… ${l}`))
    if (err) return fail(err)
    await done("Pulled")
  }
  const aiMessage = async () => {
    busy("Asking the AI for a commit message…")
    const r = await aiCommitMessage(ws)
    if (typeof r !== "string") return fail(r.error)
    setMsg(r)
    setFocus("message")
    setStatus({ text: "AI message ready: edit it, then Enter to commit", kind: "info" })
  }
  const revert = (r: Row | undefined) => {
    if (!r || !git) return
    setConfirm({
      text: `Discard all changes to ${r.entry.rel}${r.entry.untracked ? " (deletes the new file)" : ""}? (y/n)`,
      yes: async () => {
        const err = await git.revert(r.entry.path)
        if (err) fail(err)
        else await done(`Reverted ${r.entry.rel}`)
      },
    })
  }
  const open = (r: Row | undefined) => {
    if (!r) return
    void openAt(ws, r.entry.path, firstAddedLine(rawDiff), 0, 0)
  }

  // One hunk of the diff: stage or unstage it, or discard it from the file.
  const hunkAction = async (mode: "stage" | "discard") => {
    const h = hunks[hunkSel]
    if (!row || !repo || !h) return
    // A new or deleted file is one hunk with nothing around it: act on the whole file.
    if (row.entry.untracked || (row.section === "staged" ? row.entry.x : row.entry.y) === "D" || row.entry.x === "A") {
      return mode === "stage" ? toggleStage(row) : revert(row)
    }
    if (mode === "discard") {
      if (row.section !== "changes") return fail("Discard works on unstaged changes: unstage this one first (Space)")
      return setConfirm({
        text: `Discard this change in ${row.entry.rel}? (y/n)`,
        yes: async () => {
          const err = await repo.applyHunk(row.entry.path, h.text, "discard")
          if (err) fail(err)
          else await done(`Discarded a change in ${row.entry.rel}`)
        },
      })
    }
    const unstage = row.section === "staged"
    const err = await repo.applyHunk(row.entry.path, h.text, unstage ? "unstage" : "stage")
    if (err) return fail(err)
    await done(`${unstage ? "Unstaged" : "Staged"} a change in ${row.entry.rel}`)
  }

  // Right-click on a file: a menu over the panel, which stays open under it and under what its items open.
  const rowMenu = (r: Row, x: number, y: number) => {
    const g = git
    const rp = repo
    if (!g || !rp) return
    const staged = r.section === "staged"
    openOver(ws, {
      kind: "menu",
      x,
      y,
      items: [
        { label: "Open file", hint: "Enter", run: () => void openAt(ws, r.entry.path, 0, 0, 0) },
        {
          label: staged ? "Unstage" : "Stage",
          hint: "Space",
          disabled: r.section === "conflict",
          run: async () => {
            const err = staged ? await rp.unstage([r.entry.path]) : await rp.stage([r.entry.path])
            if (err) ws.notify(err, "error")
            await g.afterChange()
          },
        },
        {
          label: "Discard changes…",
          hint: "r",
          run: () =>
            openOver(ws, {
              kind: "confirm",
              title: "Discard changes",
              body: `Discard all changes to ${r.entry.rel}?${r.entry.untracked ? " This deletes the new file." : ""}`,
              options: [
                {
                  key: "d",
                  label: "Discard",
                  run: async () => {
                    const err = await g.revert(r.entry.path)
                    if (err) ws.notify(err, "error")
                    closeModal(ws)
                  },
                },
                { key: "c", label: "Cancel", run: () => closeModal(ws) },
              ],
            }),
        },
        { label: "File history", run: () => openOver(ws, { kind: "history", path: r.entry.path }) },
        { label: "Review all changes with AI", hint: "v", run: () => sendChangesForReview(ws) },
      ],
    })
  }

  // Layout: the dialog's inner height (border and padding), less the status line.
  const w = Math.min(dims.width - 4, 170)
  const leftW = Math.min(52, Math.max(30, Math.floor(w * 0.36)))
  // One more row for the repository tabs.
  const innerH = Math.max(6, dims.height - 2 - 4 - 1 - (all.length > 1 ? 1 : 0))
  const msgLines = Math.min(6, Math.max(1, message.split("\n").length))
  const b = git?.branch ?? null
  const buttons = [
    "Commit ⏎",
    "Amend",
    "AI message (m)",
    "AI review (v)",
    `Push${b?.ahead ? ` ↑${b.ahead}` : ""} (P)`,
    `Pull${b?.behind ? ` ↓${b.behind}` : ""} (U)`,
    "Branch (b)",
    "History (g)",
  ]
  const listH = Math.max(3, innerH - (1 + msgLines + 1 + wrappedRows(buttons, leftW) + 1))
  const viewH = Math.max(3, innerH - 1)
  const scrollDiff = (rows: number) => diffBox.current?.scrollBy(rows)

  const gotoHunk = (d: 1 | -1) => {
    if (!hunks.length) return
    const i = Math.max(0, Math.min(hunks.length - 1, hunkSel + d))
    setHunkSel(i)
    if (diffBox.current) diffBox.current.scrollTop = Math.max(0, hunkTops[i]! - 1)
  }

  useKeyboard((key) => {
    if (ws.ui.get().modal?.kind !== "scm") return
    const stop = () => {
      key.preventDefault()
      key.stopPropagation()
    }
    // In the message box, typing (and Ctrl+J for a new line) must reach the textarea: only take the panel's own keys.
    const messageKey = focus === "message" && !confirm && !(key.name === "return" || key.name === "escape" || key.name === "tab")
    if (messageKey) return
    stop()
    if (confirm) {
      const c = confirm
      setConfirm(null)
      if (key.name === "y") void c.yes()
      return
    }
    // An error stays until you do something else.
    if (status?.kind === "error") setGitActivity(null)
    if (key.name === "return" && key.meta) return void commit()
    if (key.name === "escape") {
      if (focus !== "list") setFocus("list")
      else close()
      return
    }
    if (key.name === "tab") {
      const order: Focus[] = hunks.length ? ["list", "message", "diff"] : ["list", "message"]
      const i = order.indexOf(focus)
      return setFocus(order[(i + (key.shift ? order.length - 1 : 1)) % order.length]!)
    }
    if (focus === "message") {
      if (key.name === "return") void commit()
      return
    }
    if (focus === "diff") {
      switch (key.name) {
        case "left":
        case "h":
          return setFocus("list")
        case "down":
        case "j":
        case "]":
          return gotoHunk(1)
        case "up":
        case "k":
        case "[":
          return gotoHunk(-1)
        case "space":
        case "s":
          return void hunkAction("stage")
        case "r":
          return void hunkAction("discard")
        case "return":
          return open(row)
        case "pagedown":
          return scrollDiff(viewH - 2)
        case "pageup":
          return scrollDiff(-(viewH - 2))
      }
      return
    }
    switch (key.name) {
      case "down":
      case "j":
        select(Math.min(rows.length - 1, sel + 1))
        break
      case "up":
      case "k":
        select(Math.max(0, sel - 1))
        break
      case "right":
      case "l":
      case "]":
        if (hunks.length) setFocus("diff")
        break
      case "space":
      case "s":
        void toggleStage(row)
        break
      case "a":
        if (key.shift) void unstageAll()
        else void stageAll()
        break
      case "r":
        if (key.shift) discardAll()
        else revert(row)
        break
      case "return":
        open(row)
        break
      case "c":
        setFocus("message")
        break
      case "m":
        void aiMessage()
        break
      case "v":
        void sendChangesForReview(ws)
        break
      case "p":
        if (key.shift) void push()
        break
      case "u":
        if (key.shift) void pull()
        break
      case "b":
        openOver(ws, { kind: "branches" })
        break
      case "g":
        openOver(ws, { kind: "history", path: null })
        break
      case "n":
        showRepo(all.indexOf(git!) + (key.shift ? -1 : 1))
        break
      case "pagedown":
        scrollDiff(viewH - 2)
        break
      case "pageup":
        scrollDiff(-(viewH - 2))
        break
    }
  })

  if (!git?.enabled || !repo) {
    return (
      <Modal title="Source control" height={5} onClose={close}>
        <text fg={colors.dim}>Not a git repository.</text>
      </Modal>
    )
  }

  const header = b ? `⎇ ${b.name}${b.ahead ? ` ↑${b.ahead}` : ""}${b.behind ? ` ↓${b.behind}` : ""}` : ""
  const btn = (label: string, run: () => void, strong = false) => (
    <HoverBox onPress={run} paddingX={1} bg={strong ? colors.accentDim : colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {label}
      </text>
    </HoverBox>
  )
  const small = (label: string, run: () => void) => (
    <HoverBox onPress={run} paddingX={1}>
      <text selectable={false} fg={colors.dim}>
        {label}
      </text>
    </HoverBox>
  )
  const sectionTitle = (s: Section) =>
    s === "conflict"
      ? `Merge conflicts (${counts.conflict})`
      : s === "staged"
        ? `Staged (${counts.staged})`
        : `Changes (${counts.changes})`
  const sectionHeading = (s: Section) => (
    <box key={`h-${s}`} height={1} flexDirection="row" overflow="hidden">
      <box flexGrow={1} overflow="hidden">
        <text selectable={false} fg={colors.headerFg} wrapMode="none">
          {sectionTitle(s)}
        </text>
      </box>
      {s === "staged" ? small("− all", () => void unstageAll()) : null}
      {s === "changes" ? small("+ all", () => void stageAll()) : null}
      {s === "changes" ? small("discard all", discardAll) : null}
    </box>
  )
  const fileRow = (r: Row, idx: number) => {
    const letter = LETTER(r.entry, r.section)
    const dir = dirname(r.entry.rel)
    const st = r.section === "conflict" ? undefined : (r.section === "staged" ? stats.staged : stats.changes).get(r.entry.path)
    const mark = ai.file(r.entry.path)
    const on = idx === sel
    return (
      <box
        key={keyOf(r)}
        height={1}
        flexDirection="row"
        overflow="hidden"
        backgroundColor={on && focus === "list" ? colors.selectionBg : on ? colors.segmentBg : undefined}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.button === 2) return rowMenu(r, e.x, e.y)
          setFocus("list")
          if (on) open(r)
          else select(idx)
        }}
      >
        <box width={3} flexShrink={0}>
          <text selectable={false} fg={letterColor(letter)}>
            {" " + letter}
          </text>
        </box>
        <box flexGrow={1} flexShrink={1} overflow="hidden">
          <text selectable={false} wrapMode="none" truncate fg={on ? colors.text : colors.dim}>
            {basename(r.entry.rel)}
            {dir !== "." ? <span fg={colors.dim}>{`  ${dir}`}</span> : null}
          </text>
        </box>
        {mark ? (
          <box flexShrink={0}>
            <text selectable={false} fg={colors.accent}>
              {" " + mark}
            </text>
          </box>
        ) : null}
        {st ? (
          <box flexShrink={0}>
            <text selectable={false} wrapMode="none">
              <span fg={colors.gitAdd}>{` +${st.add}`}</span>
              <span fg={colors.gitDel}>{` −${st.del}`}</span>
            </text>
          </box>
        ) : null}
        {/* Stage / unstage button, on the selected row only (VS Code shows it on hover). */}
        <box width={3} flexShrink={0}>
          {on && r.section !== "conflict" ? (
            <HoverBox onPress={() => void toggleStage(r)}>
              <text selectable={false} fg={colors.accent}>
                {r.section === "staged" ? " − " : " + "}
              </text>
            </HoverBox>
          ) : null}
        </box>
      </box>
    )
  }

  // The list with a heading before each section, scrolled so the selected row is in view.
  const items: { node: () => ReactNode; row: number | null }[] = []
  let lastSection: Section | null = null
  rows.forEach((r, i) => {
    if (r.section !== lastSection) {
      const s = r.section
      items.push({ node: () => sectionHeading(s), row: null })
      lastSection = s
    }
    items.push({ node: () => fileRow(r, i), row: i })
  })
  const selItem = Math.max(
    0,
    items.findIndex((it) => it.row === sel),
  )
  // The first file of a section brings its heading into view with it.
  const want = items[selItem - 1]?.row === null ? selItem - 1 : selItem
  const start = Math.max(0, Math.min(want, items.length - listH), selItem - listH + 1)
  const body = items.slice(start, start + listH).map((it) => it.node())

  const diffStat =
    row && row.section !== "conflict" ? (row.section === "staged" ? stats.staged : stats.changes).get(row.entry.path) : undefined
  const summaryLen = message.split("\n")[0]!.length
  const hint =
    focus === "diff"
      ? "↑↓ change · Space stage/unstage it · r discard it · ⏎ open · ← files · Esc back"
      : `Space stage · a/A all · r/R discard · → changes · ⏎ open · ${keyText("Alt+⏎", keyStyleOf(ws.config))} commit · P/U push/pull · m AI message${all.length > 1 ? " · n/N repository" : ""} · Esc`

  // Several repositories: a tab each, with how many files changed.
  const repoTabs =
    all.length > 1 ? (
      <box height={1} flexShrink={0} flexDirection="row" overflow="hidden" gap={1}>
        {all.map((s, i) => {
          const on = s === git
          const n = s.entries.length
          return (
            <HoverBox key={s.repo!.top} onPress={() => showRepo(i)} paddingX={1} bg={on ? colors.accentDim : colors.segmentBg}>
              <text selectable={false} fg={on ? colors.text : colors.dim}>
                {on ? <strong>{repos!.name(s)}</strong> : repos!.name(s)}
                {n ? <span fg={colors.warn}>{` ${n}`}</span> : null}
              </text>
            </HoverBox>
          )
        })}
      </box>
    ) : null
  const repoTitle = all.length > 1 && git ? `${repos!.name(git)}  ` : ""

  return (
    <Modal title={`Source control  ${repoTitle}${header}`} width={w} height={dims.height - 2} onClose={close}>
      {repoTabs}
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box width={leftW} flexShrink={0} flexDirection="column">
          <box height={1} flexDirection="row">
            <box flexGrow={1} overflow="hidden">
              <text selectable={false} fg={colors.headerFg} wrapMode="none">
                {`Message ${focus === "message" ? "(Enter commits, ^J new line)" : "(c or Tab to write)"}`}
              </text>
            </box>
            {summaryLen ? (
              <text selectable={false} fg={summaryLen > 72 ? colors.warn : colors.dim}>
                {String(summaryLen)}
              </text>
            ) : null}
          </box>
          <box
            border={["left"]}
            borderColor={focus === "message" ? colors.accent : colors.divider}
            height={msgLines}
            flexShrink={0}
            onMouseDown={() => setFocus("message")}
          >
            <textarea
              cursorStyle={cursorStyle}
              key={inputKey}
              ref={msgRef}
              initialValue={message}
              focused={focus === "message" && !confirm && onTop}
              placeholder="Commit message"
              backgroundColor={colors.bg}
              focusedBackgroundColor={colors.bg}
              textColor={colors.text}
              focusedTextColor={colors.text}
              onContentChange={() => setMessage(msgRef.current?.plainText ?? "")}
            />
          </box>
          <box height={1} />
          <box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0} flexShrink={0}>
            {btn(buttons[0]!, () => void commit(), true)}
            {btn(buttons[1]!, () => void commit(true))}
            {btn(buttons[2]!, () => void aiMessage())}
            {btn(buttons[3]!, () => void sendChangesForReview(ws))}
            {btn(buttons[4]!, () => void push())}
            {btn(buttons[5]!, () => void pull())}
            {btn(buttons[6]!, () => openOver(ws, { kind: "branches" }))}
            {btn(buttons[7]!, () => openOver(ws, { kind: "history", path: null }))}
          </box>
          <box height={1} />
          {rows.length === 0 ? (
            <box flexDirection="column">
              <text selectable={false} fg={colors.dim}>
                {`Working tree clean${b?.ahead ? ` · ↑${b.ahead} to push (P)` : ""}`}
              </text>
              {lastCommit ? (
                <text selectable={false} fg={colors.dim} wrapMode="none" truncate>
                  {`Last commit: ${lastCommit}`}
                </text>
              ) : null}
            </box>
          ) : (
            body
          )}
        </box>
        <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={() => hunks.length && setFocus("diff")}>
          <box height={1} flexShrink={0} overflow="hidden">
            {row ? (
              <text selectable={false} wrapMode="none" truncate fg={focus === "diff" ? colors.accent : colors.headerFg}>
                {row.entry.rel}
                <span
                  fg={colors.dim}
                >{`  ${row.section === "staged" ? "staged" : row.section === "conflict" ? "conflict" : "unstaged"}`}</span>
                {diffStat ? <span fg={colors.gitAdd}>{`  +${diffStat.add}`}</span> : null}
                {diffStat ? <span fg={colors.gitDel}>{` −${diffStat.del}`}</span> : null}
                {hunks.length > 1 ? <span fg={colors.dim}>{`  change ${hunkSel + 1}/${hunks.length}`}</span> : null}
              </text>
            ) : null}
          </box>
          <scrollbox ref={diffBox} flexGrow={1}>
            {hunks.length
              ? hunks.map((h, i) => {
                  const sel = focus === "diff" && i === hunkSel
                  const head = h.text.split("\n", 1)[0]
                  return (
                    <box key={i} flexDirection="column" flexShrink={0}>
                      <box height={1} overflow="hidden" backgroundColor={sel ? colors.segmentBg : undefined}>
                        <text selectable={false} wrapMode="none" fg={colors.accent}>
                          {head}
                          {sel ? " ◂" : ""}
                        </text>
                      </box>
                      <diff
                        diff={`--- a/${row?.entry.rel}\n+++ b/${row?.entry.rel}\n${h.text}\n`}
                        view="unified"
                        filetype={row ? filetypeOf(row.entry.path) : undefined}
                        syntaxStyle={syntaxStyle}
                        wrapMode="none"
                        {...diffColors}
                        contextBg={sel ? colors.segmentBg : colors.panelBg}
                        lineNumberBg={sel ? colors.segmentBg : colors.panelBg}
                      />
                    </box>
                  )
                })
              : null}
            {notes.map((l, i) => (
              <box key={`n${i}`} height={1} overflow="hidden" flexShrink={0}>
                <text selectable={false} wrapMode="none" fg={colors.dim}>
                  {l}
                </text>
              </box>
            ))}
          </scrollbox>
        </box>
      </box>
      <box height={1} flexDirection="row" overflow="hidden">
        <text
          selectable={false}
          wrapMode="none"
          truncate
          fg={
            confirm ? colors.warn : status?.kind === "error" ? colors.error : status?.kind === "busy" ? colors.warn : colors.dim
          }
        >
          {confirm?.text ?? (status ? `${status.kind === "busy" ? spin + " " : ""}${status.text}` : hint)}
        </text>
      </box>
    </Modal>
  )
}
