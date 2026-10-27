import { expect, test } from "bun:test"
import {
  AgentWatch,
  MIN_WORK_MS,
  QUIET_MS,
  looksLikeQuestion,
  notifyCommand,
  plain,
  ringBell,
  type Attention,
} from "../../src/ai/alerts"

function watch() {
  const events: Attention[] = []
  const idle: number[] = []
  return { w: new AgentWatch((e) => (e === "idle" ? idle.push(1) : events.push(e))), events, idle }
}
/** Output every 100 ms from `from` to `to`. */
function stream(w: AgentWatch, from: number, to: number, text = "thinking… ") {
  for (let t = from; t <= to; t += 100) w.output(text, t)
}

test("a stretch of work followed by quiet is reported once as finished", () => {
  const { w, events } = watch()
  stream(w, 0, MIN_WORK_MS + 500)
  w.tick(MIN_WORK_MS + 500 + QUIET_MS - 100)
  expect(events).toEqual([]) // not quiet long enough yet
  w.tick(MIN_WORK_MS + 500 + QUIET_MS)
  w.tick(MIN_WORK_MS + 500 + QUIET_MS * 3)
  expect(events).toEqual(["finished"])
})

test("short bursts (a keystroke echo, a redraw) are not work, just idle (which ends a turn)", () => {
  const { w, events, idle } = watch()
  stream(w, 0, 300)
  w.tick(300 + QUIET_MS)
  expect(events).toEqual([])
  expect(idle).toHaveLength(1)
})

test("output that stops on an approval prompt is reported as waiting, even when short", () => {
  const { w, events } = watch()
  w.output("\x1b[1mBash command\x1b[0m rm -rf build\r\n Do you want to proceed?\r\n \x1b[36m❯ 1. Yes\x1b[0m\r\n   2. No", 0)
  w.tick(QUIET_MS)
  expect(events).toEqual(["waiting"])
})

test("typing in the pane clears what was on screen: an old prompt doesn't count again", () => {
  const { w, events } = watch()
  w.output("Do you want to proceed? ❯ 1. Yes", 0)
  w.reset()
  w.tick(QUIET_MS)
  w.output("x", QUIET_MS + 100) // the echo of a keystroke
  w.tick(QUIET_MS * 3)
  expect(events).toEqual([])
})

test("each stretch of work gets its own alert", () => {
  const { w, events } = watch()
  stream(w, 0, 2500)
  w.tick(2500 + QUIET_MS)
  stream(w, 10_000, 13_000)
  w.tick(13_000 + QUIET_MS)
  expect(events).toEqual(["finished", "finished"])
})

test("prompt patterns from several CLIs", () => {
  for (const text of [
    "Do you want to make this edit to cart.ts?",
    "Allow command? (y/n)",
    "Approve this tool?",
    "❯ 1. Yes, and don't ask again",
  ]) {
    expect(looksLikeQuestion(text)).toBe(true)
  }
  expect(looksLikeQuestion("Fixed the off-by-one in total().")).toBe(false)
  expect(plain("\x1b[31mred\x1b[0m\r\n\x1b]0;title\x07next")).toBe("red next")
})

test("system notification commands per platform", () => {
  const all = () => true
  const wsl = notifyCommand("copane", "claude finished", "wsl", all)!
  expect(wsl.slice(0, 4)).toEqual(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand"])
  expect(notifyCommand("copane", 'say "hi"', "mac", all)).toEqual([
    "osascript",
    "-e",
    'display notification "say \\"hi\\"" with title "copane"',
  ])
  expect(notifyCommand("copane", "done", "linux", all)).toEqual(["notify-send", "copane", "done"])
  // Nothing installed: the caller falls back to the terminal's own notification (the renderer's).
  expect(notifyCommand("copane", "done", "linux", () => false)).toBeNull()
  let out = ""
  ringBell((s) => (out += s))
  expect(out).toBe("\x07")
})
