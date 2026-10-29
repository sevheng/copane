import { ScrollBarRenderable, type RenderContext, type ScrollBarOptions } from "@opentui/core"
import { extend } from "@opentui/react"

export interface ScrollbarOptions extends ScrollBarOptions {
  scrollSize?: number
  viewportSize?: number
  scrollPosition?: number
}

/**
 * OpenTUI's scrollbar as an element: `<scrollbar orientation=… scrollSize=… viewportSize=…
 * scrollPosition=… onChange=…>`. It hides itself while the content fits (the layout then gives
 * its row or column back), and the thumb drags with the mouse, so the editor and the file tree
 * scroll sideways in terminals that send no Shift+wheel or tilt-wheel events (Windows Terminal).
 */
export class ScrollbarRenderable extends ScrollBarRenderable {
  constructor(ctx: RenderContext, { scrollSize, viewportSize, scrollPosition, ...options }: ScrollbarOptions) {
    super(ctx, options)
    if (scrollSize !== undefined) this.scrollSize = scrollSize
    if (viewportSize !== undefined) this.viewportSize = viewportSize
    if (scrollPosition !== undefined) this.scrollPosition = scrollPosition
  }

  // OpenTUI hands the viewport size to the slider (the thumb's length) before it updates the
  // slider's range, which clamps it to the old range: a bar whose content fitted when the viewport
  // was set keeps a one-cell thumb. Set it again once both are known.
  override get scrollSize(): number {
    return super.scrollSize
  }
  override set scrollSize(value: number) {
    super.scrollSize = value
    this.sizeThumb()
  }
  override get viewportSize(): number {
    return super.viewportSize
  }
  override set viewportSize(value: number) {
    super.viewportSize = value
    this.sizeThumb()
  }
  private sizeThumb(): void {
    if (this.isDestroyed || this.slider.isDestroyed) return
    this.slider.viewPortSize = Math.max(1, this.viewportSize)
  }
}

extend({ scrollbar: ScrollbarRenderable })

declare module "@opentui/react" {
  interface OpenTUIComponents {
    scrollbar: typeof ScrollbarRenderable
  }
}
