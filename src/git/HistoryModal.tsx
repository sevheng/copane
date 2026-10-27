import { useEffect, useRef, useState } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { openFile } from "../app/navHistory"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace } from "../app/workspace"
import { diffColors, ui as colors } from "../config/theme"
import type { LogEntry } from "./repo"
import { shortAgo } from "./blame"
import { clipCols } from "../editor/CodeEditorRenderable"
import { closeModal } from "../app/modalStack"
import { filetypeOf } from "../editor/grammars"
import { useSyntaxStyle } from "../editor/syntaxStyle"

/** `git show` output: the header (commit, author, message, stat), then one part per file. */
export function splitShow(out: string): { header: string[]; files: { path: string; patch: string; info: string[] }[] } {
  const at = out.search(/^diff --git /m)
  const header = (at < 0 ? out : out.slice(0, at)).replace(/\n+$/, "").split("\n")
  const files = at < 0 ? [] : out.slice(at).split(/^(?=diff --git )/m)
  return {
    header,
    files: files.map((part) => {
      const lines = part.replace(/\n+$/, "").split("\n")
      const path = lines[0]!.match(/^diff --git a\/.* b\/(.*)$/)?.[1] ?? lines[0]!
      const hunk = lines.findIndex((l) => l.startsWith("@@"))
      // No hunks (binary, a rename, a mode change): git's own lines say what changed.
      const info = (hunk < 0 ? lines.slice(1) : []).filter((l) => !l.startsWith("index "))
      return { path, patch: hunk < 0 ? "" : part, info }
    }),
  }
}

/**
 * File history (commits touching a file, with that file's diff per commit) or a single
 * commit (from blame). ↑↓ choose, PgUp/PgDn scroll, y copies the sha, Enter opens the file.
 */
export function HistoryModal({ path, sha }: { path: string | null; sha?: string }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  // A file's history comes from its own repository; the project's from the current one.
  const repo = (path ? ws.git?.for(path)?.repo : ws.git?.repo) ?? null
  const [commits, setCommits] = useState<LogEntry[] | null>(null)
  const [sel, setSel] = useState(0)
  const [shown, setShown] = useState<ReturnType<typeof splitShow>>({ header: [], files: [] })
  const box = useRef<ScrollBoxRenderable | null>(null)
  const syntaxStyle = useSyntaxStyle()
  const close = () => closeModal(ws)

  useEffect(() => {
    if (!repo) return setCommits([])
    if (sha) setCommits([{ sha, author: "", when: "", time: 0, subject: "" }])
    else void repo.log(path ?? undefined).then(setCommits)
  }, [repo, path, sha])

  const current = commits?.[sel]
  useEffect(() => {
    let live = true
    if (box.current) box.current.scrollTop = 0
    if (!repo || !current) return setShown({ header: [], files: [] })
    void repo.show(current.sha, sha ? undefined : (path ?? undefined)).then((d) => live && setShown(splitShow(d)))
    return () => {
      live = false
    }
  }, [repo, current?.sha, path, sha])

  const viewH = Math.max(4, dims.height - 7)
  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "escape" || key.name === "q") close()
    else if (key.name === "down" || key.name === "j") setSel((s) => Math.min((commits?.length ?? 1) - 1, s + 1))
    else if (key.name === "up" || key.name === "k") setSel((s) => Math.max(0, s - 1))
    else if (key.name === "pagedown" || key.name === "space") box.current?.scrollBy(viewH - 2)
    else if (key.name === "pageup") box.current?.scrollBy(-(viewH - 2))
    else if (key.name === "y" && current) void ws.clipboard.copy(current.sha).then(() => ws.notify(`Copied ${current.sha}`))
    else if (key.name === "return" && path) {
      ws.ui.set({ modal: null }) // to the editor, not back to a dialog
      void openFile(ws, path)
    }
  })

  const color = (l: string) =>
    l.startsWith("commit ") || l.startsWith("Author:") || l.startsWith("Date:") ? colors.warn : colors.text
  const w = Math.min(dims.width - 4, 170)
  const listW = sha ? 0 : Math.min(64, Math.floor(w * 0.42))
  // Who and when on each row (GitLens style), when the list has room for a subject too.
  const authorW = listW >= 44 ? Math.min(14, Math.floor(listW * 0.25)) : 0
  const title = sha
    ? `Commit ${sha.slice(0, 8)}`
    : `History: ${path ? repo?.rel(path) : "repository"}${commits ? ` (${commits.length})` : ""}`
  const listTop = Math.max(0, Math.min(sel - viewH + 1, (commits?.length ?? 0) - viewH))

  return (
    <Modal title={`${title}   ↑↓ commit · PgDn scroll · y copy sha · Esc`} width={w} height={viewH + 4} onClose={close}>
      <box flexDirection="row" flexGrow={1} gap={2}>
        {listW ? (
          <box width={listW} flexShrink={0} flexDirection="column">
            {commits === null ? (
              <text fg={colors.dim}>Loading…</text>
            ) : commits.length === 0 ? (
              <text fg={colors.dim}>No commits for this file yet.</text>
            ) : (
              commits.slice(listTop, listTop + viewH).map((c, i) => {
                const idx = listTop + i
                return (
                  <box
                    key={c.sha}
                    height={1}
                    flexDirection="row"
                    overflow="hidden"
                    backgroundColor={idx === sel ? colors.selectionBg : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSel(idx)
                    }}
                  >
                    <text selectable={false} fg={colors.warn}>
                      {c.sha.slice(0, 7)}{" "}
                    </text>
                    {authorW ? (
                      <text selectable={false} wrapMode="none" fg={colors.headerFg}>
                        {clipCols(c.author, authorW - 1).padEnd(authorW)}
                        {shortAgo(c.time).padStart(3)}{" "}
                      </text>
                    ) : null}
                    <text selectable={false} wrapMode="none" fg={idx === sel ? colors.text : colors.dim}>
                      {c.subject}
                    </text>
                  </box>
                )
              })
            )}
          </box>
        ) : null}
        <box flexGrow={1} flexDirection="column" overflow="hidden">
          {current && !sha && current.author ? (
            <box height={1}>
              <text selectable={false} fg={colors.headerFg}>
                {current.author} · {current.when}
              </text>
            </box>
          ) : null}
          <scrollbox ref={box} flexGrow={1}>
            {shown.header.map((l, i) => (
              <box key={`h${i}`} height={1} overflow="hidden" flexShrink={0}>
                <text selectable={false} wrapMode="none" fg={color(l)}>
                  {l || " "}
                </text>
              </box>
            ))}
            {shown.files.map((f, i) => (
              <box key={`f${i}`} flexDirection="column" flexShrink={0}>
                <box height={1} />
                <box height={1} overflow="hidden" backgroundColor={colors.segmentBg}>
                  <text selectable={false} wrapMode="none" fg={colors.accent}>
                    {f.path}
                  </text>
                </box>
                {f.patch ? (
                  <diff
                    diff={f.patch}
                    view="unified"
                    filetype={filetypeOf(f.path)}
                    syntaxStyle={syntaxStyle}
                    wrapMode="none"
                    {...diffColors}
                  />
                ) : (
                  f.info.map((l, j) => (
                    <box key={j} height={1} overflow="hidden">
                      <text selectable={false} wrapMode="none" fg={colors.dim}>
                        {l}
                      </text>
                    </box>
                  ))
                )}
              </box>
            ))}
          </scrollbox>
        </box>
      </box>
    </Modal>
  )
}
