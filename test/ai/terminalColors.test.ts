import { expect, test } from "bun:test"
import { colorSequence, resetsColors } from "../../src/ai/terminalColors"

const bytes = (s: string) => new TextEncoder().encode(s)

test("the theme's colours become OSC 10 (foreground) and OSC 11 (background)", () => {
  expect(colorSequence("#e8e6e3", "#121212")).toBe("\x1b]10;#e8e6e3\x07\x1b]11;#121212\x07")
})

test("a full reset or a reset of the default colours is spotted", () => {
  expect(resetsColors(bytes("\x1bc"))).toBe(true)
  expect(resetsColors(bytes("some output\x1bcmore"))).toBe(true)
  expect(resetsColors(bytes("\x1b]111\x07"))).toBe(true)
  expect(resetsColors(bytes("\x1b]110\x1b\\"))).toBe(true)
})

test("a program setting its own colours, a query, or plain text is not a reset", () => {
  expect(resetsColors(bytes("\x1b]11;#000000\x07"))).toBe(false)
  expect(resetsColors(bytes("\x1b]11;?\x07"))).toBe(false)
  expect(resetsColors(bytes("\x1b]112\x07"))).toBe(false) // reset cursor colour
  expect(resetsColors(bytes("\x1b[c"))).toBe(false) // a DA query, not RIS
  expect(resetsColors(bytes("c 111 \x1b[0m"))).toBe(false)
})
