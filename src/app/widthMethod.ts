import type { CliRenderer, WidthMethod } from "@opentui/core"

// OpenTUI's "unicode" gives a whole grapheme one cell's worth of width, so a spacing vowel
// sign (Khmer ា, Myanmar ာ) adds nothing. Terminals (Windows Terminal, xterm.js) give each letter
// and spacing sign of the cluster a cell of its own, which pushed Khmer lines past the pane and
// let the next run of text overwrite letters. "unicode-wide", with copane's native patch
// (patches/opentui-native@*.patch, built by scripts/opentui-native.sh), counts them that way and
// otherwise measures the same (emoji, CJK, ZWJ sequences); it matches Bun.stringWidth, which the
// editor uses for columns. "wcwidth" (OPENTUI_FORCE_WCWIDTH) is left as it is.
export function wideMarks(method: WidthMethod): WidthMethod {
  return method === "unicode" ? "unicode-wide" : method
}

export function useWideMarks(renderer: CliRenderer) {
  const proto = Object.getPrototypeOf(renderer)
  const get = Object.getOwnPropertyDescriptor(proto, "widthMethod")?.get
  if (!get) return
  Object.defineProperty(renderer, "widthMethod", { get: () => wideMarks(get.call(renderer)) })
}
