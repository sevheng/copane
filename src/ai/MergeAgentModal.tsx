import { useEffect, useRef, useState } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { openFile } from "../app/navHistory"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { join } from "node:path"
import { HoverBox, Modal } from "../app/Modal"
import { useWorkspace, type Workspace } from "../app/workspace"
import { diffColors, ui as colors } from "../config/theme"
import { GitRepo, type WorktreeChange } from "../git/repo"
import { filetypeOf } from "../editor/grammars"
import { useSyntaxStyle } from "../editor/syntaxStyle"
import { worktreeOf } from "./TerminalPane"
import { closeModal, openOver } from "../app/modalStack"

const LETTER_COLOR = { A: colors.ok, M: colors.warn, D: colors.error } as const

/**
 * Bring a worktree agent's work back: every file it changed since its branch split off
 * (committed or not) with its diff, then merge it into your branch (m) or throw it away (d).
 */
export function MergeAgentModal({ sessionId }: { sessionId: number }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const session = ws.agents?.session(sessionId)
  const repo = ws.git?.main.repo ?? null
  const agent = session ? new GitRepo(worktreeOf(session)) : null
  const [base, setBase] = useState<string | null>(null)
  const [changes, setChanges] = useState<WorktreeChange[] | null>(null)
  const [sel, setSel] = useState(0)
  const [diff, setDiff] = useState("")
  const box = useRef<ScrollBoxRenderable | null>(null)
  const syntaxStyle = useSyntaxStyle()
  const [status, setStatus] = useState<{ text: string; kind: "info" | "error" | "busy" } | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; yes: () => void } | null>(null)
  // Your uncommitted files the merge would overwrite (git refused): commit them, then merge again.
  const [blocked, setBlocked] = useState<string[] | null>(null)
  const close = () => closeModal(ws)
  const change = changes?.[Math.min(sel, changes.length - 1)]

  useEffect(() => {
    if (!session?.branch || !repo || !agent) return
    let live = true
    void (async () => {
      const b = await repo.mergeBase(session.branch!)
      if (!live) return
      if (!b) return setStatus({ text: `Can't find where ${session.branch} split off`, kind: "error" })
      setBase(b)
      const list = await agent.changesSince(b)
      if (live) setChanges(list)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, repo])

  useEffect(() => {
    if (box.current) box.current.scrollTop = 0
    if (!change || !base || !agent) return setDiff("")
    let live = true
    void agent.diffSince(base, change).then((d) => live && setDiff(d))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change?.rel, base])

  const merge = async () => {
    if (!session?.branch || !repo || !agent) return
    // The agent must not write while its work is committed and merged: stop its CLI first.
    setStatus({ text: "Stopping the agent, then merging…", kind: "busy" })
    await ws.agents?.stop(sessionId)
    const err = await agent.commitAll(`Work from ${session.name}`)
    if (err) return setStatus({ text: `Couldn't commit the agent's leftover work: ${err}`, kind: "error" })
    const r = await repo.merge(session.branch)
    await ws.git?.afterChange()
    if ("error" in r && r.blocked) {
      setBlocked(r.blocked)
      const names = r.blocked.slice(0, 3).join(", ") + (r.blocked.length > 3 ? ` +${r.blocked.length - 3} more` : "")
      return setStatus({
        text: `Not merged: your uncommitted changes to ${names} would be overwritten. c commit them and merge · s Source control`,
        kind: "error",
      })
    }
    if ("error" in r) return setStatus({ text: `Merge failed: ${r.error}`, kind: "error" })
    if ("conflicts" in r) {
      close()
      return ws.notify(
        `Merge has conflicts in ${r.conflicts} file${r.conflicts === 1 ? "" : "s"}: resolve them with the bar in each file (Alt+1/2/3), then commit`,
        "warn",
      )
    }
    afterMerge(ws, sessionId, worktreeOf(session), session.branch, changes?.length ?? 0)
  }

  /** Commit everything uncommitted in your project (it blocked the merge), then merge again. */
  const commitMineAndMerge = async () => {
    if (!repo || !session?.branch) return
    const n = (await repo.status()).length
    const message = `Your work before merging ${session.branch}`
    setConfirm({
      text: `Commit all ${n} uncommitted file${n === 1 ? "" : "s"} in your project ("${message}"), then merge? (y/n)`,
      yes: async () => {
        setStatus({ text: "Committing your changes…", kind: "busy" })
        const err = await repo.commitAll(message)
        await ws.git?.afterChange()
        if (err) return setStatus({ text: `Couldn't commit your changes: ${err}`, kind: "error" })
        setBlocked(null)
        await merge()
      },
    })
  }

  const discard = () => {
    if (!session?.branch || !repo) return
    const n = changes?.length ?? 0
    setConfirm({
      text: `Throw away ${n} changed file${n === 1 ? "" : "s"}, the worktree and branch ${session.branch} for good? (y/n)`,
      yes: async () => {
        await ws.agents?.stop(sessionId)
        const err = await repo.removeWorktree(worktreeOf(session), true)
        if (err) return setStatus({ text: `Couldn't remove the worktree: ${err}`, kind: "error" })
        await repo.deleteBranch(session.branch!, true)
        ws.agents?.close(sessionId)
        close()
        ws.notify(`Discarded ${session.name}'s work (${session.branch})`)
      },
    })
  }

  const open = () => {
    if (!change || !session || change.status === "D") return
    close()
    void openFile(ws, join(worktreeOf(session), change.rel))
  }

  const viewH = dims.height - 8
  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (confirm) {
      const c = confirm
      setConfirm(null)
      if (key.name === "y") c.yes()
      return
    }
    const n = changes?.length ?? 0
    if (key.name === "escape") close()
    else if (key.name === "down" || key.name === "j") setSel((i) => Math.min(Math.max(0, n - 1), i + 1))
    else if (key.name === "up" || key.name === "k") setSel((i) => Math.max(0, i - 1))
    else if (key.name === "pagedown") box.current?.scrollBy(viewH)
    else if (key.name === "pageup") box.current?.scrollBy(-viewH)
    else if (key.name === "return") open()
    else if (key.name === "m" && n) void merge()
    else if (key.name === "d") discard()
    else if (key.name === "c" && blocked) void commitMineAndMerge()
    else if (key.name === "s" && blocked) openOver(ws, { kind: "scm" })
  })

  if (!session?.branch) {
    return (
      <Modal title="Review & merge" height={6} onClose={close}>
        <text fg={colors.dim}>
          This agent doesn't work in its own git worktree, so there is nothing to merge: its changes are already in your project.
        </text>
      </Modal>
    )
  }
  const w = Math.min(dims.width - 4, 170)
  const leftW = Math.max(28, Math.floor(w * 0.3))
  const into = ws.git?.main.branch?.name ?? "your branch"
  const btn = (label: string, run: () => void) => (
    <HoverBox onPress={run} paddingX={1} bg={colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {label}
      </text>
    </HoverBox>
  )
  return (
    <Modal
      title={`Review & merge ${session.name} (${session.branch}) into ${into}`}
      width={w}
      height={dims.height - 2}
      onClose={close}
    >
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box width={leftW} flexShrink={0} flexDirection="column">
          <box flexDirection="row" gap={1} height={1}>
            {btn("Merge (m)", () => void merge())}
            {btn("Discard (d)", discard)}
          </box>
          {blocked && (
            <box flexDirection="row" gap={1} height={1} marginTop={1}>
              {btn("Commit mine & merge (c)", () => void commitMineAndMerge())}
              {btn("Source control (s)", () => openOver(ws, { kind: "scm" }))}
            </box>
          )}
          <box height={1} />
          {changes === null ? (
            <text selectable={false} fg={colors.dim}>
              Reading the agent's changes…
            </text>
          ) : changes.length === 0 ? (
            <text selectable={false} fg={colors.dim}>
              No changes yet: the agent hasn't changed any files.
            </text>
          ) : (
            changes.map((c, i) => (
              <box
                key={c.rel}
                height={1}
                flexDirection="row"
                overflow="hidden"
                backgroundColor={i === sel ? colors.selectionBg : undefined}
                onMouseDown={() => setSel(i)}
              >
                <text selectable={false} fg={LETTER_COLOR[c.status]}>
                  {c.status + " "}
                </text>
                <text selectable={false} wrapMode="none" truncate fg={colors.text}>
                  {c.rel}
                </text>
              </box>
            ))
          )}
        </box>
        <scrollbox ref={box} flexGrow={1}>
          {diff && change ? (
            <diff
              diff={`--- a/${change.rel}\n+++ b/${change.rel}\n${diff}`}
              view="unified"
              filetype={filetypeOf(change.rel)}
              syntaxStyle={syntaxStyle}
              wrapMode="none"
              {...diffColors}
            />
          ) : null}
        </scrollbox>
      </box>
      <box height={1} flexDirection="row" overflow="hidden">
        <text
          selectable={false}
          fg={
            confirm ? colors.warn : status?.kind === "error" ? colors.error : status?.kind === "busy" ? colors.warn : colors.dim
          }
        >
          {confirm?.text ?? status?.text ?? "↑↓ file · Enter open · m merge into your branch · d discard · Esc close"}
        </text>
      </box>
    </Modal>
  )
}

/** Merged: offer to clean up the worktree, its branch and the tab. */
function afterMerge(ws: Workspace, sessionId: number, cwd: string, branch: string, files: number): void {
  const repo = ws.git?.main.repo
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: "Merged",
      body: `Merged ${files} changed file${files === 1 ? "" : "s"} from ${branch}. Remove the worktree and the branch, and close the agent's tab?`,
      options: [
        {
          key: "r",
          label: "Remove and close",
          run: async () => {
            ws.ui.set({ modal: null })
            ws.agents?.close(sessionId)
            // Everything was committed and merged: a clean removal. Anything new since (the
            // agent was stopped first, but an editor tab could have saved there) keeps it.
            const err = await repo?.removeWorktree(cwd)
            if (!err) await repo?.deleteBranch(branch)
            ws.notify(err ? `Merged; worktree kept: ${err}` : `Merged ${branch} and removed its worktree`, err ? "warn" : "info")
          },
        },
        {
          key: "k",
          label: "Keep them",
          run: () => {
            ws.ui.set({ modal: null })
            ws.agents?.recount(sessionId)
            ws.notify(`Merged ${branch}`)
          },
        },
      ],
    },
  })
}
