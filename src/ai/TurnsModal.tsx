import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { safely } from "../app/safely"
import { useWorkspace } from "../app/workspace"
import { openAt } from "../app/navHistory"
import { diffColors, ui as colors } from "../config/theme"
import { hunkPatch, hunks, type Hunk } from "../editor/hunks"
import { filetypeOf } from "../editor/grammars"
import { useSyntaxStyle } from "../editor/syntaxStyle"
import { relTo, type Turn, type TurnFile } from "./turns"
import { closeModal } from "../app/modalStack"

type Focus = "turns" | "files" | "changes"

// toLocaleTimeString puts a narrow no-break space before AM/PM, which terminals draw zero-width.
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(/\s/g, " ")

/** A file's changes within one turn (the same file can appear in several turns). */
const key = (turn: Turn, path: string) => `${turn.id}:${path}`

/** +added −removed lines of a turn, from its files' changes. */
function lineCounts(changes: Map<string, Hunk[]>, turn: Turn): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const f of turn.files) for (const h of changes.get(key(turn, f.path)) ?? []) ((add += h.newLines), (del += h.oldLines))
  return { add, del }
}

/**
 * Ctrl+Alt+Z: what the AI changed, turn by turn. Review each file's changes from before the turn,
 * and undo a whole turn (u), one file (x) or one change (r).
 */
export function TurnsModal() {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const log = ws.turns
  const stored = useSyncExternalStore(log?.store.subscribe ?? (() => () => {}), () => log?.store.get().turns ?? [])
  const turns = useMemo(() => [...stored].reverse(), [stored])
  const [focus, setFocus] = useState<Focus>("turns")
  const [ti, setTi] = useState(0)
  const [fi, setFi] = useState(0)
  const [hi, setHi] = useState(0)
  const [confirm, setConfirm] = useState<{ text: string; yes: () => Promise<void> } | null>(null)
  // Each turn's files' changes now (before the turn → current content), by turn and file;
  // computed when turns arrive or after an undo, not on every move through the list.
  const [changes, setChanges] = useState(new Map<string, Hunk[]>())
  const [version, setVersion] = useState(0)
  const turn = turns[Math.min(ti, turns.length - 1)]
  const file: TurnFile | undefined = turn?.files[Math.min(fi, turn.files.length - 1)]
  const fileHunks = file && turn ? (changes.get(key(turn, file.path)) ?? []) : []
  const close = () => closeModal(ws)

  useEffect(() => {
    if (!log) return
    let stale = false
    void (async () => {
      const next = new Map<string, Hunk[]>()
      const contents = new Map<string, string>() // each file read once, however many turns touched it
      for (const t of turns) {
        for (const f of t.files) {
          if (!contents.has(f.path)) contents.set(f.path, (await log.contentNow(f.path)) ?? "")
          next.set(key(t, f.path), f.known ? hunks(f.before ?? "", contents.get(f.path)!) : [])
        }
      }
      if (!stale) setChanges(next)
    })()
    return () => {
      stale = true
    }
  }, [log, turns, version])

  const done = (text: string) => {
    setVersion((v) => v + 1)
    ws.notify(text)
  }
  const undoTurn = async (t: Turn) => {
    const edited = await log!.editedSince(t)
    const run = async () => done(`Undid ${await log!.undo(t)} file(s) from ${time(t.startedAt)}`)
    if (edited.length)
      setConfirm({ text: `${edited.length} file(s) changed since this turn; undo anyway and lose those edits? (y/n)`, yes: run })
    else await run()
  }
  const undoFile = async (t: Turn, f: TurnFile) => {
    if (!f.known) return ws.notify("Can't undo this file: its content before the turn isn't known", "warn")
    await log!.undo(t, [f.path])
    done(`Undid ${relTo(ws.root, f.path)}`)
  }
  const undoChange = async (f: TurnFile, i: number) => {
    if (await log!.undoHunk(f, i)) done(`Undid change ${i + 1} in ${relTo(ws.root, f.path)}`)
    else ws.notify("Can't undo this change", "warn")
  }
  const open = (f: TurnFile, h?: Hunk) => {
    close()
    void openAt(ws, f.path, h?.newStart ?? 0, 0, 0)
  }

  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (confirm) {
      const c = confirm
      setConfirm(null)
      if (key.name === "y") void c.yes()
      return
    }
    const move = (d: number) => {
      if (focus === "turns") (setTi((i) => Math.max(0, Math.min(turns.length - 1, i + d))), setFi(0), setHi(0))
      else if (focus === "files") (setFi((i) => Math.max(0, Math.min((turn?.files.length ?? 1) - 1, i + d))), setHi(0))
      else setHi((i) => Math.max(0, Math.min(fileHunks.length - 1, i + d)))
    }
    if (key.name === "escape") close()
    else if (key.name === "tab")
      setFocus((f) =>
        key.shift
          ? f === "turns"
            ? "changes"
            : f === "files"
              ? "turns"
              : "files"
          : f === "turns"
            ? "files"
            : f === "files"
              ? "changes"
              : "turns",
      )
    else if (key.name === "down" || key.name === "j") move(1)
    else if (key.name === "up" || key.name === "k") move(-1)
    else if ((key.name === "u" || key.name === "x" || key.name === "r") && turn && !turn.endedAt) {
      // Undoing while the AI still writes would race its next edit (and lose it, or ours).
      ws.notify("The AI is still working on this turn: undo once it has finished", "warn")
    } else if (key.name === "u" && turn) void safely(ws, () => undoTurn(turn))
    else if (key.name === "x" && turn && file) void safely(ws, () => undoFile(turn, file))
    else if (key.name === "r" && file && fileHunks[hi]) void safely(ws, () => undoChange(file, hi))
    else if (key.name === "return" && file) open(file, focus === "changes" ? fileHunks[hi] : fileHunks[0])
  })

  const w = Math.min(dims.width - 4, 170)
  const h = dims.height - 2
  const leftW = Math.max(32, Math.floor(w * 0.36))
  const row = (selected: boolean, active: boolean) => (selected ? (active ? colors.selectionBg : colors.segmentBg) : undefined)

  if (!log || !turns.length) {
    return (
      <Modal title="AI turns" height={6} onClose={close}>
        <text fg={colors.dim}>No AI changes yet. Each prompt you send that changes files becomes a turn here, with undo.</text>
      </Modal>
    )
  }

  const viewH = h - 6

  return (
    <Modal
      title="AI turns   Tab move · u undo turn · x undo file · r undo change · Enter open · Esc"
      width={w}
      height={h}
      onClose={close}
    >
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box width={leftW} flexShrink={0} flexDirection="column">
          {turns.slice(0, Math.max(3, Math.floor(viewH / 2))).map((t, i) => {
            const c = lineCounts(changes, t)
            return (
              <box key={t.id} height={1} overflow="hidden" backgroundColor={row(i === ti, focus === "turns")}>
                <text selectable={false} wrapMode="none">
                  <span
                    fg={t.endedAt ? colors.text : colors.warn}
                  >{`${time(t.startedAt)} · ${t.files.length} file${t.files.length === 1 ? "" : "s"} `}</span>
                  <span fg={colors.gitAdd}>{`+${c.add} `}</span>
                  <span fg={colors.gitDel}>{`−${c.del} `}</span>
                  <span fg={colors.dim}>{t.endedAt ? t.prompt : "working…"}</span>
                </text>
              </box>
            )
          })}
          <box height={1} />
          {turn?.files.map((f, i) => (
            <box key={f.path} height={1} flexDirection="row" overflow="hidden" backgroundColor={row(i === fi, focus === "files")}>
              <text selectable={false} fg={f.before === null ? colors.gitAdd : colors.gitMod}>
                {f.before === null && f.known ? "A " : "M "}
              </text>
              <text selectable={false} fg={f.known ? colors.text : colors.dim}>
                {relTo(ws.root, f.path) + (f.known ? "" : "  (can't undo)")}
              </text>
            </box>
          ))}
        </box>
        <box flexGrow={1} flexDirection="column">
          {fileHunks.length === 0 ? (
            <text selectable={false} fg={colors.dim}>
              {file && !file.known
                ? "The content before this turn isn't known (binary, or ignored by git)."
                : "No difference from before this turn (already undone?)."}
            </text>
          ) : (
            <Changes
              path={file!.path}
              relPath={relTo(ws.root, file!.path)}
              hunks={fileHunks}
              selected={focus === "changes" ? hi : -1}
              height={viewH}
            />
          )}
        </box>
      </box>
      {confirm ? (
        <text selectable={false} fg={colors.warn}>
          {confirm.text}
        </text>
      ) : null}
    </Modal>
  )
}

/** A file's changes as numbered blocks, each an OpenTUI <diff>; the selected one is marked and kept in view. */
function Changes(props: { path: string; relPath: string; hunks: Hunk[]; selected: number; height: number }) {
  const syntaxStyle = useSyntaxStyle()
  const box = useRef<ScrollBoxRenderable | null>(null)
  const filetype = filetypeOf(props.path)
  // Row where each block starts: its header, then one row per removed and added line.
  const starts: number[] = []
  let row = 0
  for (const hk of props.hunks) (starts.push(row), (row += 1 + hk.removed.length + hk.added.length))
  const target = Math.max(0, (starts[Math.max(0, props.selected)] ?? 0) - 2)
  useEffect(() => {
    if (box.current) box.current.scrollTop = target
  }, [target])
  return (
    <scrollbox ref={box} height={props.height}>
      {props.hunks.map((hk, i) => {
        const sel = i === props.selected
        return (
          <box key={i} flexDirection="column" flexShrink={0}>
            <box height={1} backgroundColor={sel ? colors.segmentBg : undefined}>
              <text selectable={false} fg={colors.accent}>
                {`── change ${i + 1} · line ${hk.newStart + 1} ${sel ? "◂" : ""}`}
              </text>
            </box>
            <diff
              diff={hunkPatch(hk, props.relPath)}
              view="unified"
              filetype={filetype}
              syntaxStyle={syntaxStyle}
              wrapMode="none"
              {...diffColors}
            />
          </box>
        )
      })}
    </scrollbox>
  )
}
