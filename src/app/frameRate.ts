import type { CliRenderer } from "@opentui/core"

/**
 * Frames per second while something moves (smooth scrolling, GIFs, spinners): OpenTUI's frame
 * loop runs at `targetFps` then (its default is 30), and stops when nothing does, so an idle
 * editor draws nothing. Other frames (a key, new output) come on demand, at most `maxFps`.
 * 60 locally; 30 over SSH, where every frame crosses the network.
 */
export function frameRate(caps: { remote?: boolean } | null | undefined): number {
  return caps?.remote ? 30 : 60
}

/** Set the frame rate now and again once the terminal has answered OpenTUI's queries. */
export function useFrameRate(renderer: CliRenderer): void {
  const apply = (caps: { remote?: boolean } | null | undefined) => {
    renderer.targetFps = frameRate(caps)
    renderer.maxFps = 60
  }
  apply(renderer.capabilities)
  renderer.on("capabilities", apply)
}
