import { expect, test } from "bun:test"
import { frameRate } from "../../src/app/frameRate"

test("animations run at 60 fps locally and 30 over SSH", () => {
  expect(frameRate({ remote: false })).toBe(60)
  expect(frameRate(null)).toBe(60)
  expect(frameRate({ remote: true })).toBe(30)
})
