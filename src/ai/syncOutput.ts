/**
 * Synchronized output (DEC mode 2026) for the AI pane. A CLI that redraws its screen (Claude Code
 * does on every update) wraps each redraw in `ESC [ ? 2026 h` ... `ESC [ ? 2026 l` so the terminal
 * shows it all at once. OpenTUI's embedded terminal ignores the mode, and a frame painted between
 * two pieces of one redraw shows a half-drawn screen: the flicker. The gate holds output while a
 * redraw is open and hands it on whole, as Windows Terminal, Ghostty and VS Code do. A redraw that
 * never closes is let through after `timeoutMs`, so a crashed CLI can't freeze the pane.
 */
const BEGIN = [0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x68] // ESC [ ? 2 0 2 6 h
const END_BYTE = 0x6c // l: the same sequence, ending in `l`
const LEN = BEGIN.length

export class SyncGate {
  private held: Uint8Array[] = []
  private open = false
  /** The last bytes of the previous chunk, for a sequence split across two reads. */
  private tail = new Uint8Array(0)
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly write: (data: Uint8Array) => void,
    private readonly timeoutMs = 150,
  ) {}

  push(data: Uint8Array): void {
    const last = this.lastMarker(data)
    if (last !== null) this.open = last
    if (this.open) {
      this.held.push(data)
      this.timer ??= setTimeout(() => this.release(), this.timeoutMs)
    } else if (this.held.length) {
      this.held.push(data)
      this.flush()
    } else this.write(data)
  }

  /** Hand on whatever is held now (before writing text of copane's own into the pane). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.held.length) return
    const parts = this.held
    this.held = []
    this.write(parts.length === 1 ? parts[0]! : concat(parts))
  }

  /** Drop what is held and start over (the tab closed, or its screen is being reset). */
  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.held = []
    this.open = false
    this.tail = new Uint8Array(0)
  }

  private release(): void {
    this.timer = null
    this.open = false
    this.flush()
  }

  /** true / false for the last begin / end marker in the chunk (one split from the last chunk counts), null for none. */
  private lastMarker(data: Uint8Array): boolean | null {
    const text = this.tail.length ? concat([this.tail, data]) : data
    this.tail = text.slice(Math.max(0, text.length - (LEN - 1)))
    for (let i = text.lastIndexOf(0x1b); i !== -1; i = i > 0 ? text.lastIndexOf(0x1b, i - 1) : -1) {
      if (i + LEN > text.length) continue
      let match = true
      for (let k = 1; k < LEN - 1 && match; k++) match = text[i + k] === BEGIN[k]
      if (!match) continue
      const end = text[i + LEN - 1]
      if (end === BEGIN[LEN - 1]) return true
      if (end === END_BYTE) return false
    }
    return null
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0
  for (const p of parts) size += p.length
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
