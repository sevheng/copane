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
    ["ឆាយ សិរីសិទ្ធ", 9],
    ["លោក ឆាយ ស៊ីណា និង លោកស្រី", 20],
    ["ក្កា", 3],
    ["ភ្ញៀវ", 4],
    ["ដើម្បី", 4],
    ["ភ្ញៀវកិត្តិយសដើម្បីរៀបចំពិធីជូន", 21],
  ]
  for (const [s, w] of terminal) {
    // A miss on the subscript cases means node_modules has OpenTUI's own library: run scripts/opentui-native.sh.
    expect(measureEditText(s, { widthMethod: "unicode-wide" })).toBe(w)
    expect(Bun.stringWidth(s)).toBe(w)
  }
  for (const s of ["😀", "👨‍👩‍👧", "❤️", "🇰🇭", "中文", "नमस्ते"])
    expect(measureEditText(s, { widthMethod: "unicode-wide" })).toBe(measureEditText(s, { widthMethod: "unicode" }))
})
