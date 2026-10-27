import { expect, test } from "bun:test"
import { Glide } from "../../src/app/glide"

test("a glide moves the whole distance in shrinking steps", async () => {
  const steps: number[] = []
  new Glide(true, 5).by(30, (k) => steps.push(k))
  await Bun.sleep(120)
  expect(steps.reduce((a, b) => a + b, 0)).toBe(30)
  expect(steps[0]).toBe(10) // a third of what's left first...
  expect(steps.at(-1)).toBe(1) // ...down to single lines at the end
  for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]!)
})

test("same-direction scrolls add up; the other direction starts over", async () => {
  let pos = 0
  const g = new Glide(true, 5)
  g.by(6, (k) => (pos += k))
  g.by(6, (k) => (pos += k))
  await Bun.sleep(100)
  expect(pos).toBe(12)
  g.by(9, (k) => (pos += k))
  g.by(-3, (k) => (pos += k)) // drops what was left of the +9
  await Bun.sleep(100)
  expect(pos).toBeLessThan(12 + 9)
  expect(g.active).toBe(false)
})

test("stop ends it where it is; disabled moves at once", async () => {
  let pos = 0
  const g = new Glide(true, 5)
  g.by(60, (k) => (pos += k))
  g.stop()
  const at = pos
  await Bun.sleep(50)
  expect(pos).toBe(at)
  const off = new Glide(false)
  let moved = 0
  off.by(7, (k) => (moved += k))
  expect(moved).toBe(7)
})

test("on the renderer's frames: one step per frame, sized by the time since the last", () => {
  const queue: ((dt: number) => void)[] = []
  const frames = {
    requestAnimationFrame: (cb: (dt: number) => void) => queue.push(cb) - 1,
    cancelAnimationFrame: () => {},
  }
  const steps: number[] = []
  new Glide(true, 16, frames).by(30, (k) => steps.push(k))
  expect(steps).toEqual([10]) // the first step at once, as with the timer
  queue.shift()!(32) // a 30 fps frame: two 16 ms thirds of the 20 left
  expect(steps[1]).toBe(12) // 20 × (1 − (2/3)²) = 11.1, rounded up
  while (queue.length) queue.shift()!(32)
  expect(steps.reduce((a, b) => a + b, 0)).toBe(30)
})

test("no frames coming (renderer suspended): the rest moves at once", () => {
  let pos = 0
  const g = new Glide(true, 16, { requestAnimationFrame: () => -1, cancelAnimationFrame: () => {} })
  g.by(30, (k) => (pos += k))
  expect(pos).toBe(30)
  expect(g.active).toBe(false)
})
