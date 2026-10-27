import type { CliRenderer } from "@opentui/core"

/** React commits since the last log line (counted by perfCommit through a <Profiler>). */
let commits = 0
let commitMs = 0
/** For <Profiler onRender>: counts React commits and their render time. React keeps profiling only in development builds (`bun run dev`), so the compiled binary logs no commits. */
export function perfCommit(_id: string, _phase: string, actualMs: number): void {
  commits++
  commitMs += actualMs
}

/**
 * Opt-in performance log (CE_PERF=/path/to/log): time from each keypress to the end of the
 * next rendered frame, frames that take longer than 50 ms, and React commits per second.
 */
export function installPerfLog(renderer: CliRenderer): void {
  const path = Bun.env.CE_PERF
  if (!path) return
  const writer = Bun.file(path).writer()
  const tick = setInterval(() => {
    if (!commits) return
    writer.write(`commits ${commits}/s ${commitMs.toFixed(1)}ms\n`)
    writer.flush()
    commits = 0
    commitMs = 0
  }, 1000)
  tick.unref?.()
  let pendingKey: { name: string; at: number } | null = null
  renderer.keyInput.on("keypress", (k: { name: string }) => {
    pendingKey ??= { name: k.name, at: performance.now() }
  })
  // "frame" comes once a frame is drawn: the key's time ends there.
  renderer.on("frame", () => {
    if (!pendingKey) return
    writer.write(`key ${pendingKey.name} ${(performance.now() - pendingKey.at).toFixed(1)}ms\n`)
    writer.flush()
    pendingKey = null
  })
  renderer.setFrameCallback(async (deltaMs: number) => {
    if (deltaMs > 50) writer.write(`gap ${deltaMs.toFixed(1)}ms at ${performance.now().toFixed(0)}\n`)
  })
}

/**
 * Opt-in memory log (CE_MEM=/path/to/log): every 10 s, the process's private memory (RssAnon on
 * Linux, else RSS) and the JS heap, to see what a window costs over a session.
 */
export function installMemLog(): void {
  const path = Bun.env.CE_MEM
  if (!path) return
  const writer = Bun.file(path).writer()
  const mb = (n: number) => `${(n / 1048576).toFixed(1)}M`
  const tick = setInterval(async () => {
    const status = await Bun.file("/proc/self/status")
      .text()
      .catch(() => "")
    const anon = /RssAnon:\s+(\d+) kB/.exec(status)?.[1]
    const { rss, heapUsed } = process.memoryUsage()
    writer.write(
      `${new Date().toISOString()} private ${anon ? mb(Number(anon) * 1024) : "?"} rss ${mb(rss)} heap ${mb(heapUsed)}\n`,
    )
    writer.flush()
  }, 10_000)
  tick.unref?.()
}
