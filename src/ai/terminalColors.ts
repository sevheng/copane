/**
 * The AI pane's default text and background colours come from the theme, not from the terminal
 * copane runs in: the emulator takes them as OSC 10 (foreground) and OSC 11 (background), the
 * sequences a program uses to set a terminal's default colours, and answers a program's OSC 10/11
 * query with them (Claude Code asks for the background to pick a light or dark look). copane
 * sets them when a tab starts and again when the program drops them: a full reset (`ESC c`), or
 * OSC 110/111, "back to the default foreground/background".
 */
export function colorSequence(fg: string, bg: string): string {
  return `\x1b]10;${fg}\x07\x1b]11;${bg}\x07`
}

const ESC = 0x1b
const RIS = 0x63 // c
const OSC = 0x5d // ]

/** Whether output resets the default colours to the emulator's own. */
export function resetsColors(data: Uint8Array): boolean {
  for (let i = data.indexOf(ESC); i !== -1; i = data.indexOf(ESC, i + 1)) {
    const next = data[i + 1]
    if (next === RIS) return true
    // OSC 110 / OSC 111: "ESC ] 11 0" or "ESC ] 11 1", then the terminator.
    if (next === OSC && data[i + 2] === 0x31 && data[i + 3] === 0x31 && (data[i + 4] === 0x30 || data[i + 4] === 0x31)) {
      const end = data[i + 5]
      if (end === 0x07 || end === ESC || end === undefined) return true
    }
  }
  return false
}
