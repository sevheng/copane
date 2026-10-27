import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stateDirProblem } from "../../src/app/stateDir"

const tmp = () => mkdtempSync(join(tmpdir(), "cea-state-"))

test("a writable state folder is no problem, and the check leaves nothing behind", async () => {
  const base = join(tmp(), "state")
  expect(await stateDirProblem(base)).toBeNull()
  expect(Array.from(new Bun.Glob("*").scanSync({ cwd: join(base, "copane"), dot: true }))).toEqual([])
})

test("a state folder owned by someone else (a `sudo` run) is reported with the fix", async () => {
  const base = join(tmp(), "state")
  await Bun.write(join(base, "other/x"), "")
  chmodSync(base, 0o555)
  try {
    const problem = await stateDirProblem(base)
    expect(problem).toContain("recent folders")
    expect(problem).toContain(`sudo chown -R ${Bun.env.USER}`)
  } finally {
    chmodSync(base, 0o755)
  }
})
