import { ScrollBoxRenderable, type MouseEvent } from "@opentui/core"
import { extend } from "@opentui/react"
import { Glide } from "./glide"

/** A scrollbox whose wheel scrolling glides (see Glide) instead of jumping a few lines at once. */
export class SmoothScrollBoxRenderable extends ScrollBoxRenderable {
  readonly glide = new Glide(true, 16, this._ctx)

  set smooth(on: boolean) {
    this.glide.enabled = on
  }

  override onMouseEvent(event: MouseEvent): void {
    const dir = event.scroll?.direction
    if (event.type !== "scroll" || event.modifiers.shift || !this.glide.enabled || (dir !== "up" && dir !== "down"))
      return super.onMouseEvent(event)
    const delta = event.scroll?.delta ?? 0
    this.glideBy(dir === "up" ? -delta : delta)
  }

  /** Scroll by `lines`, gliding. */
  glideBy(lines: number): void {
    this.glide.by(lines, (k) => {
      if (this.isDestroyed) return this.glide.stop()
      const before = this.scrollTop
      this.scrollTop = before + k
      if (this.scrollTop === before) this.glide.stop() // at the top or bottom
    })
  }
}

extend({ "smooth-scrollbox": SmoothScrollBoxRenderable })

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "smooth-scrollbox": typeof SmoothScrollBoxRenderable
  }
}
