import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepos } from "../../src/git/repos"
import { ago, describeBlame } from "../../src/git/blame"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

const ENV = {
  GIT_AUTHOR_NAME: "Ann Dev",
  GIT_AUTHOR_EMAIL: "a@d",
  GIT_COMMITTER_NAME: "Ann Dev",
  GIT_COMMITTER_EMAIL: "a@d",
  GIT_OPTIONAL_LOCKS: "0",
}
let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
const sh = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV } }).stdout.toString()
const until = (cond: () => boolean | Promise<boolean>, ms = 4000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

test("ago and describeBlame", () => {
  const now = 1_000_000_000
  expect(ago(now - 30, now)).toBe("just now")
  expect(ago(now - 3 * 86_400, now)).toBe("3 days ago")
  expect(ago(now - 3_600, now)).toBe("1 hour ago")
  expect(describeBlame({ sha: "0".repeat(40), author: "", time: 0, summary: "" })).toBe("Not committed yet")
})

test("status bar shows blame for the cursor line; history and commit views open", async () => {
  const root = await fixture({ "a.ts": "one\ntwo\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "Start the file")
  writeFileSync(join(root, "a.ts"), "one\nTWO\n")
  sh(root, "commit", "-qam", "Shout line two")
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = GitRepos.single(git)
  await ws.buffers.open("a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  const ta = ws.buffers.active!.textarea!
  ta.setCursor(1, 0)
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  await until(() => h!.lines().at(-2)!.includes("Shout line two"))
  expect(h.lines().at(-2)).toContain("Ann Dev · just now · Shout line two")

  // An unsaved edit on that line reads as not committed.
  ta.setText("one\nchanged\n")
  ws.buffers.onContentChange(ws.buffers.active!.id)
  ta.setCursor(1, 0)
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  await until(() => h!.lines().at(-2)!.includes("Not committed yet"))
  expect(h.lines().at(-2)).toContain("Not committed yet")

  // Line 1 blame → commit view.
  ta.setCursor(0, 0)
  ws.buffers.onCursorChange(ws.buffers.active!.id)
  const { runCommand } = await import("../../src/keymap/commands")
  await runCommand(ws, "git.blameLine")
  // The title shows at once; the commit's details arrive from git a moment later.
  await until(() => h!.frame().includes("Start the file"))
  expect(h.frame()).toContain("Start the file")
  await h.step(() => h!.keys.pressEscape())
  await Bun.sleep(150)

  // File history lists both commits, newest first, with the diff of the selected one.
  // Ctrl+Alt+G (Ctrl+Alt+H would arrive as Alt+Backspace in terminals).
  await h.step(() => h!.keys.pressKey("g", { ctrl: true, meta: true }))
  await until(() => h!.frame().includes("History: a.ts (2)"))
  await until(() => /\+ +TWO/.test(h!.frame()))
  const f = h.frame()
  expect(f.indexOf("Shout line two")).toBeLessThan(f.indexOf("Start the file"))
  expect(f).toMatch(/\+ +TWO/)
}, 20_000)

test("blames of one file run one at a time; one replaced by a newer request is skipped", async () => {
  const { blameFor } = await import("../../src/git/blame")
  const { GitRepo } = await import("../../src/git/repo")
  const root = await fixture({ "a.ts": "one\ntwo\n" })
  sh(root, "init", "-q")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  const repo = new GitRepo(root)
  let active = 0
  let most = 0
  let calls = 0
  const real = repo.blame.bind(repo)
  repo.blame = async (p, c) => {
    calls++
    most = Math.max(most, ++active)
    try {
      return await real(p, c)
    } finally {
      active--
    }
  }
  const ws = { git: { for: () => ({ repo }), contentsVersion: 0 } } as never
  const path = join(root, "a.ts")
  const first = blameFor(ws, path, "one\ntwo\n", "1:1")
  await waitUntil(() => calls === 1, 2000) // running
  const skipped = blameFor(ws, path, "one\nTWO\n", "1:2")
  const last = blameFor(ws, path, "ONE\nTWO\n", "1:3")
  expect(await first).toHaveLength(2)
  expect(await skipped).toEqual([])
  expect((await last).map((l) => l.sha)).toEqual(["0".repeat(40), "0".repeat(40)])
  expect(most).toBe(1)
  expect(calls).toBe(2)
})
