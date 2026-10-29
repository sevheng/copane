import { expect, test } from "bun:test"
import { SyncGate } from "../../src/ai/syncOutput"

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const BSU = "\x1b[?2026h"
const ESU = "\x1b[?2026l"

function gate(timeoutMs = 150) {
  const out: string[] = []
  const g = new SyncGate((d) => out.push(dec(d)), timeoutMs)
  return { g, out, push: (s: string) => g.push(enc(s)) }
}

test("output outside a redraw goes straight through", () => {
  const { out, push } = gate()
  push("hello")
  push(`${BSU}frame${ESU}`)
  expect(out).toEqual(["hello", `${BSU}frame${ESU}`])
})

test("a redraw split over several reads arrives as one write", () => {
  const { out, push } = gate()
  push(`${BSU}top `)
  push("middle ")
  expect(out).toEqual([])
  push(`bottom${ESU}tail`)
  expect(out).toEqual([`${BSU}top middle bottom${ESU}tail`])
})

test("a marker split between two reads still counts", () => {
  const { out, push } = gate()
  push("a\x1b[?20")
  push("26hb")
  expect(out).toEqual(["a\x1b[?20"]) // written before the marker was whole: harmless, it's before the redraw
  push("c\x1b[?2")
  push("026l")
  expect(out).toEqual(["a\x1b[?20", "26hbc\x1b[?2026l"])
})

test("a chunk ending inside the next redraw is held until that one closes", () => {
  const { out, push } = gate()
  push(`${BSU}one${ESU}${BSU}two`)
  expect(out).toEqual([])
  push(ESU)
  expect(out).toEqual([`${BSU}one${ESU}${BSU}two${ESU}`])
})

test("a redraw that never closes is let through after the timeout", async () => {
  const { out, push } = gate(20)
  push(`${BSU}stuck`)
  expect(out).toEqual([])
  await Bun.sleep(60) // the gate's own timer, not a wait for the app
  expect(out).toEqual([`${BSU}stuck`])
  push("after")
  expect(out).toEqual([`${BSU}stuck`, "after"])
})

test("flush hands on what is held; reset drops it", () => {
  const { g, out, push } = gate()
  push(`${BSU}partial`)
  g.flush()
  expect(out).toEqual([`${BSU}partial`])
  push("more")
  g.reset()
  push("fresh")
  expect(out).toEqual([`${BSU}partial`, "fresh"])
})

test("other private modes don't open a redraw", () => {
  const { out, push } = gate()
  push("\x1b[?2004h\x1b[?1049h\x1b[?2027h")
  expect(out).toHaveLength(1)
})
