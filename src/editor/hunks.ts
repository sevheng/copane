import { diffArrays } from "diff"

/** A run of changed lines between a base (the index) and the buffer. Indexes are 0-based. */
export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  removed: string[]
  added: string[]
}

export function hunks(base: string, current: string): Hunk[] {
  const a = base.split("\n")
  const b = current.split("\n")
  const out: Hunk[] = []
  let oi = 0
  let ni = 0
  let cur: Hunk | null = null
  for (const part of diffArrays(a, b)) {
    const n = part.count ?? part.value.length
    if (!part.added && !part.removed) {
      if (cur) out.push(cur)
      cur = null
      oi += n
      ni += n
      continue
    }
    cur ??= { oldStart: oi, oldLines: 0, newStart: ni, newLines: 0, removed: [], added: [] }
    if (part.removed) {
      cur.removed.push(...part.value)
      cur.oldLines += n
      oi += n
    } else {
      cur.added.push(...part.value)
      cur.newLines += n
      ni += n
    }
  }
  if (cur) out.push(cur)
  return out
}

/** The hunk covering `row` in the buffer (a deletion counts on the line where it happened). */
export function hunkAt(list: Hunk[], row: number): Hunk | undefined {
  return list.find((h) => row >= h.newStart && row < h.newStart + Math.max(1, h.newLines))
}

/** Next / previous hunk after / before `row`, wrapping around. */
export function nextHunk(list: Hunk[], row: number, dir: 1 | -1): Hunk | undefined {
  if (!list.length) return undefined
  if (dir === 1) return list.find((h) => h.newStart > row) ?? list[0]
  return [...list].reverse().find((h) => h.newStart + Math.max(1, h.newLines) - 1 < row) ?? list.at(-1)
}

/** The buffer with one hunk put back to the base lines. */
export function revertHunk(current: string, h: Hunk): string {
  const lines = current.split("\n")
  lines.splice(h.newStart, h.newLines, ...h.removed)
  return lines.join("\n")
}

/** The base with just one hunk applied (what the index becomes when staging that hunk). */
export function applyHunk(base: string, h: Hunk): string {
  const lines = base.split("\n")
  lines.splice(h.oldStart, h.oldLines, ...h.added)
  return lines.join("\n")
}

/** One hunk as a unified patch, without context (for OpenTUI's <diff>). */
export function hunkPatch(h: Hunk, path: string): string {
  // A side with no lines names the line before the change (unified diff convention).
  const range = (start: number, n: number) => `${n ? start + 1 : start},${n}`
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@`,
    ...h.removed.map((l) => `-${l}`),
    ...h.added.map((l) => `+${l}`),
    "",
  ].join("\n")
}
