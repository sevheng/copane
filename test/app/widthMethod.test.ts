import { expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import { wideMarks } from "../../src/app/widthMethod"

test("grapheme widths count spacing vowel signs; wcwidth stays", () => {
  expect(wideMarks("unicode")).toBe("unicode-wide")
  expect(wideMarks("wcwidth")).toBe("wcwidth")
  expect(wideMarks("unicode-wide")).toBe("unicode-wide")
})

// Widths Windows Terminal and xterm.js report (cursor position after printing), which is also Bun.stringWidth.
test("unicode-wide measures Khmer as terminals draw it, and emoji like unicode", () => {
  const terminal: [string, number][] = [
    ["កា", 2],
    ["ក្រ", 2],
    ["ស្រី", 2],
    ["លោក", 3],
    ["ក្កា", 3],
    ["ភ្ញៀវ", 4],
    ["ដើម្បី", 4],
    ["ក្រុមគ្រួសារ", 8],
  ]
  for (const [s, w] of terminal) {
    // A miss on the subscript cases means node_modules has OpenTUI's own library: run scripts/opentui-native.sh.
    expect(measureEditText(s, { widthMethod: "unicode-wide" })).toBe(w)
    expect(Bun.stringWidth(s)).toBe(w)
  }
  for (const s of ["😀", "👨‍👩‍👧", "❤️", "🇰🇭", "中文", "नमस्ते"])
    expect(measureEditText(s, { widthMethod: "unicode-wide" })).toBe(measureEditText(s, { widthMethod: "unicode" }))
})

// Khmer fonts draw ឃ ញ ឈ ណ ឍ យ ល ស ហ ឤ wider than a cell: they get a spare one, which the next sign or
// letter of their cluster uses (terminals count one; OpenTUI places the next cell itself).
test("unicode-wide gives wide Khmer letters a spare cell", () => {
  const padded: [string, number, number][] = [
    // text, copane's cells, the terminal's
    ["ណ", 2, 1],
    ["ស", 2, 1],
    ["សា", 2, 2],
    ["ណា", 2, 2],
    ["ហែ", 2, 2],
    ["ស្រី", 2, 2],
    ["ក្ស", 2, 2],
    ["កំណត់", 4, 3],
    ["ឆាយ", 4, 3],
    ["លោក ឆាយ ស៊ីណា និង លោកស្រី", 22, 20],
  ]
  for (const [s, w, terminal] of padded) {
    expect(measureEditText(s, { widthMethod: "unicode-wide" })).toBe(w)
    expect(Bun.stringWidth(s)).toBe(terminal)
  }
})
