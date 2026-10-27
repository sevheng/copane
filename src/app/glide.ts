/** The renderer's frame loop (`renderer.requestAnimationFrame`): each step then lands on a drawn frame. */
export interface Frames {
  requestAnimationFrame(callback: (deltaTime: number) => void): number
  cancelAnimationFrame(handle: number): void
}

/**
 * Smooth scrolling: spread a scroll of some lines over a few frames, fast first and slowing at
 * the end (a third of what's left every 16 ms: about 50 ms for a wheel step, 150 ms for a page).
 * A scroll that arrives mid-glide in the same direction adds to it, so a fast wheel spin stays
 * fluid; one the other way starts over. With `frames` it steps once per rendered frame (a step's
 * size follows the time since the last one, so the speed doesn't depend on the frame rate);
 * without, a third per tick of a `frameMs` timer.
 */
export class Glide {
  private remaining = 0
  private move: ((k: number) => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private frame: number | null = null

  /** Whether to glide at all; off, `by` moves at once. */
  constructor(
    public enabled = true,
    private frameMs = 16,
    private frames?: Frames,
  ) {}

  get active(): boolean {
    return this.timer !== null || this.frame !== null
  }

  /** Move `total` lines in steps; `move` is called with each step's lines. */
  by(total: number, move: (k: number) => void): void {
    if (!total) return
    if (!this.enabled) return move(total)
    if (this.active && Math.sign(this.remaining) === Math.sign(total)) {
      this.remaining += total
      this.move = move
      return
    }
    this.stop()
    this.remaining = total
    this.move = move
    if (this.frames) this.next()
    else this.timer = setInterval(() => this.step(16), this.frameMs)
    this.step(16)
  }

  /** End the glide where it is. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.frame !== null) this.frames?.cancelAnimationFrame(this.frame)
    this.timer = null
    this.frame = null
    this.remaining = 0
    this.move = null
  }

  private next(): void {
    const handle = this.frames!.requestAnimationFrame((dt) => {
      this.frame = null
      this.step(dt)
      if (this.remaining) this.next()
    })
    if (handle >= 0) return void (this.frame = handle)
    // No frames coming (the renderer is suspended): finish at once.
    const [left, move] = [this.remaining, this.move]
    this.stop()
    if (left && move) move(left)
  }

  private step(ms: number): void {
    const left = this.remaining
    const move = this.move
    if (!left || !move) return this.stop()
    // A third of what's left per 16 ms.
    const share = 1 - Math.pow(2 / 3, Math.max(ms, 1) / 16)
    const k = Math.sign(left) * Math.min(Math.abs(left), Math.max(1, Math.ceil(Math.abs(left) * share - 1e-9)))
    this.remaining -= k
    move(k)
    if (this.remaining === 0) this.stop()
  }
}
