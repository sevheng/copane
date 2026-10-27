import { expect, test } from "bun:test"
import { applyHunk, hunkAt, hunkPatch, hunks, nextHunk, revertHunk } from "../../src/editor/hunks"
import { parsePatch } from "diff"

const base = "a\nb\nc\nd\ne\nf\n"
const current = "a\nB\nc\nd\nnew\ne\n" // b→B, insert "new" before e, delete f

test("hunks: modification, insertion and deletion", () => {
  const hs = hunks(base, current)
  expect(hs.map((h) => [h.newStart, h.newLines, h.removed, h.added])).toEqual([
    [1, 1, ["b"], ["B"]],
    [4, 1, [], ["new"]],
    [6, 0, ["f"], []],
  ])
  expect(hunkAt(hs, 1)).toBe(hs[0])
  expect(hunkAt(hs, 2)).toBeUndefined()
  expect(hunkAt(hs, 6)).toBe(hs[2]) // deletion shows on the following line
  expect(nextHunk(hs, 1, 1)).toBe(hs[1])
  expect(nextHunk(hs, 6, 1)).toBe(hs[0]) // wraps
  expect(nextHunk(hs, 4, -1)).toBe(hs[0])
  expect(nextHunk(hs, 0, -1)).toBe(hs[2]) // wraps backwards
})

test("revert one hunk; stage one hunk", () => {
  const hs = hunks(base, current)
  expect(revertHunk(current, hs[0]!)).toBe("a\nb\nc\nd\nnew\ne\n")
  expect(revertHunk(current, hs[2]!)).toBe("a\nB\nc\nd\nnew\ne\nf\n")
  // Staging only the first hunk: the index gets B but not the others.
  expect(applyHunk(base, hs[0]!)).toBe("a\nB\nc\nd\ne\nf\n")
  // Index positions stay valid for later hunks too (oldStart is in base coordinates).
  expect(applyHunk(base, hs[1]!)).toBe("a\nb\nc\nd\nnew\ne\nf\n")
})

test("hunkPatch: each hunk as a unified patch with the right line numbers", () => {
  const [changed, inserted, deleted] = hunks(base, current)
  expect(hunkPatch(changed!, "f.txt")).toBe("--- a/f.txt\n+++ b/f.txt\n@@ -2,1 +2,1 @@\n-b\n+B\n")
  // No old lines: the range names the line before the insert (d, line 4).
  expect(hunkPatch(inserted!, "f.txt")).toContain("@@ -4,0 +5,1 @@\n+new\n")
  expect(hunkPatch(deleted!, "f.txt")).toContain("@@ -6,1 +6,0 @@\n-f\n")
  for (const h of [changed!, inserted!, deleted!]) expect(parsePatch(hunkPatch(h, "f.txt"))[0]!.hunks).toHaveLength(1)
})
