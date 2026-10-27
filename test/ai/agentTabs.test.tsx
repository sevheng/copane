import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { restorableTabs, TerminalPane, worktreeFor, type AiConfig } from "../../src/ai/TerminalPane"
import type { MenuItem } from "../../src/app/state"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepos } from "../../src/git/repos"
import { parseWorktrees } from "../../src/git/repo"
import { createWorkspace, editorShown, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.ws.ai?.kill()
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
// Agents start, stop and git worktrees change here: slow under a loaded machine.
const until = (cond: () => boolean | Promise<boolean>, ms = 8000) => waitUntil(cond, ms, () => h?.setup.renderOnce())
const ENV = GIT_ENV

const config = (): AiConfig => ({
  command: "/bin/sh",
  args: ["-c", "echo first-agent-ready; exec cat"],
  maxScrollbackBytes: 100_000,
  notify: "off",
  agents: [{ name: "second", command: "/bin/sh", args: ["-c", "echo second-agent-ready; exec cat"] }],
})

async function pane(root: string) {
  const ws = createWorkspace(root, {}, editorShown())
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={config()} /> }, { width: 140, height: 24 })
  await until(() => h!.frame().includes("first-agent-ready"))
  return ws
}
/** A menu item; running it closes the menu first, as a click on it does. */
const menuItem = (ws: ReturnType<typeof createWorkspace>, label: string) => {
  const modal = ws.ui.get().modal
  if (modal?.kind !== "menu") throw new Error("no menu open")
  const item = modal.items.find((i: MenuItem) => i.label === label)!
  return { ...item, run: () => (ws.ui.set({ modal: null }), item.run()) }
}

test("a second agent opens in its own tab; text goes to the visible tab; tabs switch and close", async () => {
  const ws = await pane(await fixture({ "a.txt": "a" }))
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  expect(menuItem(ws, "New second in a git worktree").disabled).toBe(true) // not a git repo
  await h!.step(() => menuItem(ws, "New second").run())
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(h!.frame()).toContain("SECOND")
  expect(h!.frame()).not.toContain("first-agent-ready") // the first tab is hidden, still running

  await h!.step(() => ws.ai!.type("hello-to-second"))
  await until(() => h!.frame().includes("hello-to-second"))
  await h!.step(() => ws.agents!.cycle(1))
  await until(() => h!.frame().includes("first-agent-ready"))
  expect(h!.frame()).not.toContain("hello-to-second")
  await h!.step(() => ws.ai!.type("hello-to-first"))
  await until(() => h!.frame().includes("hello-to-first"))

  await h!.step(() => ws.agents!.closeActive())
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(h!.frame()).toContain("hello-to-second")
  await h!.step(() => ws.agents!.closeActive())
  expect(ws.ui.get().notice?.text).toContain("only agent")
})

test("an agent in a git worktree works on its own branch; closing can remove the worktree", async () => {
  const root = await fixture({ "a.txt": "a" })
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "."],
    ["commit", "-qm", "init"],
  ])
    Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = await pane(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = GitRepos.single(git)
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  await h!.step(() => menuItem(ws, "New second in a git worktree").run())
  const wt = worktreeFor(root, "second", 1)
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(existsSync(join(wt.path, "a.txt"))).toBe(true)
  expect(h!.frame()).toContain("SECOND ⎇ SECOND-1")
  const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: wt.path, env: ENV }).stdout.toString().trim()
  expect(branch).toBe("copane/second-1")

  await h!.step(() => ws.agents!.closeActive())
  const modal = ws.ui.get().modal
  expect(modal?.kind).toBe("confirm")
  if (modal?.kind !== "confirm") return
  await h!.step(() => modal.options.find((o) => o.key === "r")!.run())
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  expect(Bun.spawnSync(["git", "branch", "--list", "copane/second-1"], { cwd: root, env: ENV }).stdout.toString()).toContain(
    "copane/second-1",
  )
})

test("worktree paths sit beside the project, with a branch per agent", () => {
  expect(worktreeFor("/work/app", "Claude Code", 2)).toEqual({
    path: "/work/app-claude-code-2",
    branch: "copane/claude-code-2",
    cwd: "/work/app-claude-code-2",
  })
  // Opened in a subfolder of the repo: the worktree goes beside the repo, the agent starts in the same subfolder.
  expect(worktreeFor("/work/mono/pkg/app", "claude", 1, "/work/mono")).toEqual({
    path: "/work/mono-claude-1",
    branch: "copane/claude-1",
    cwd: "/work/mono-claude-1/pkg/app",
  })
})

test("× on a tab closes it, and so does a middle-click; a single tab has neither", async () => {
  const ws = await pane(await fixture({ "a.txt": "a" }))
  expect(h!.frame()).not.toContain("×")
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  await h!.step(() => menuItem(ws, "New second").run())
  await until(() => h!.frame().includes("second-agent-ready"))
  const x = h!.findAt("×", 60) // the first tab's ×, in the AI pane's header
  await h!.step(() => h!.mouse.click(x.x, x.y))
  await until(() => !h!.frame().includes("×"))
  expect(h!.frame()).not.toContain("SH ") // the first tab (/bin/sh) is gone
  expect(h!.frame()).toContain("SECOND")
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  await h!.step(() => menuItem(ws, "New second").run())
  await until(() => h!.frame().includes("SECOND 2"))
  const tab = h!.find("SECOND 2")
  await h!.step(() => h!.mouse.click(tab.x, tab.y, 1))
  await until(() => !h!.frame().includes("SECOND 2"))
  expect(h!.frame()).not.toContain("SECOND 2")
})

async function worktreeAgent() {
  const root = await fixture({ "a.txt": "a\n", "b.txt": "b\n" })
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "."],
    ["commit", "-qm", "init"],
  ])
    Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = await pane(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = GitRepos.single(git)
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  await h!.step(() => menuItem(ws, "New second in a git worktree").run())
  const wt = worktreeFor(root, "second", 1)
  await until(() => h!.frame().includes("second-agent-ready"))
  // The agent's work: one commit, one uncommitted edit, one new file.
  writeFileSync(join(wt.path, "a.txt"), "a by agent\n")
  Bun.spawnSync(["git", "commit", "-qam", "agent: a"], { cwd: wt.path, env: ENV })
  writeFileSync(join(wt.path, "b.txt"), "b by agent\n")
  writeFileSync(join(wt.path, "new.txt"), "new\n")
  return { root, ws, wt }
}
const gitOut = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, env: ENV }).stdout.toString()

test("review & merge a worktree agent: its files and diffs, merge, then clean up", async () => {
  const { root, ws, wt } = await worktreeAgent()
  ws.agents!.recount(ws.agents!.activeId())
  // The tab counts its changed files, after its mark; a click on the count opens Review & merge.
  await until(() => /SECOND ⎇ SECOND-1 \S · 3/.test(h!.frame()))

  const count = h!.find("· 3")
  await h!.step(() => h!.mouse.click(count.x + 2, count.y))
  await until(() => h!.frame().includes("new.txt") && /\+ +a by agent/.test(h!.frame()))
  const f = h!.frame()
  expect(f).toContain("Review & merge second (copane/second-1) into main")
  for (const row of ["M a.txt", "M b.txt", "A new.txt"]) expect(f).toContain(row)
  expect(f).toMatch(/\+ +a by agent/) // the first file's diff
  await h!.step(() => h!.keys.pressArrow("down"))
  await until(() => /\+ +b by agent/.test(h!.frame()))

  await h!.step(() => h!.keys.pressKey("m"))
  await until(() => ws.ui.get().modal?.kind === "confirm")
  expect(await Bun.file(join(root, "b.txt")).text()).toBe("b by agent\n")
  expect(await Bun.file(join(root, "new.txt")).text()).toBe("new\n")
  expect(gitOut(root, "log", "--oneline", "-1")).toContain("Merge branch 'copane/second-1'")
  const modal = ws.ui.get().modal
  if (modal?.kind !== "confirm") throw new Error("no confirm")
  await h!.step(() => modal.options.find((o) => o.key === "r")!.run())
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  // The branch goes after the worktree folder: wait for it too.
  await until(() => gitOut(root, "branch", "--list", "copane/second-1") === "")
  expect(gitOut(root, "branch", "--list", "copane/second-1")).toBe("")
  await until(() => !h!.frame().includes("SECOND"))
  expect(h!.frame()).not.toContain("SECOND ⎇")
})

test("merge blocked by your uncommitted edits: it names the files, and c commits them and merges", async () => {
  const { root, ws } = await worktreeAgent()
  // You edited b.txt too, without committing: git refuses to merge over it.
  writeFileSync(join(root, "b.txt"), "b mine\n")
  ws.agents!.recount(ws.agents!.activeId())
  await until(() => /SECOND ⎇ SECOND-1 \S · 3/.test(h!.frame()))
  const count = h!.find("· 3")
  await h!.step(() => h!.mouse.click(count.x + 2, count.y))
  await until(() => h!.frame().includes("A new.txt"))

  await h!.step(() => h!.keys.pressKey("m"))
  await until(() => h!.frame().includes("your uncommitted changes to b.txt would be overwritten"))
  expect(h!.frame()).toContain("Commit mine & merge (c)")
  expect(await Bun.file(join(root, "b.txt")).text()).toBe("b mine\n") // untouched

  await h!.step(() => h!.keys.pressKey("c"))
  await until(() => h!.frame().includes("Commit all 1 uncommitted file"))
  await h!.step(() => h!.keys.pressKey("y"))
  // Yours is committed, then the merge runs: b.txt changed on both sides, so it conflicts.
  await until(() => ws.ui.get().modal === null)
  expect(gitOut(root, "log", "--format=%s", "-1", "HEAD")).toContain("Your work before merging copane/second-1")
  expect(await Bun.file(join(root, "b.txt")).text()).toContain("<<<<<<<")
})

test("discarding a worktree agent's work removes its worktree, branch and tab", async () => {
  const { root, ws, wt } = await worktreeAgent()
  await h!.step(() => ws.agents!.closeActive())
  const modal = ws.ui.get().modal
  if (modal?.kind !== "confirm") throw new Error("no confirm")
  expect(modal.options.map((o) => o.label)).toContain("Review & merge first")
  await h!.step(() => modal.options.find((o) => o.key === "m")!.run())
  await until(() => h!.frame().includes("A new.txt"))
  await h!.step(() => h!.keys.pressKey("d"))
  await until(() => h!.frame().includes("Throw away 3 changed files"))
  await h!.step(() => h!.keys.pressKey("y"))
  await until(() => !existsSync(wt.path))
  expect(existsSync(wt.path)).toBe(false)
  // The branch goes after the worktree folder: wait for it too.
  await until(() => gitOut(root, "branch", "--list", "copane/second-1") === "")
  expect(gitOut(root, "branch", "--list", "copane/second-1")).toBe("")
  expect(await Bun.file(join(root, "b.txt")).text()).toBe("b\n") // nothing came back
  await until(() => !h!.frame().includes("SECOND ⎇"))
  expect(h!.frame()).not.toContain("SECOND ⎇")
})

test("a new worktree agent skips a number whose branch was kept after its worktree was removed", async () => {
  const root = await fixture({ "a.txt": "a" })
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "."],
    ["commit", "-qm", "init"],
    ["branch", "copane/second-1"],
  ])
    Bun.spawnSync(["git", ...args], { cwd: root, env: ENV })
  const ws = await pane(root)
  git = new GitStatus(root)
  await git.start(60_000)
  ws.git = GitRepos.single(git)
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  await h!.step(() => menuItem(ws, "New second in a git worktree").run())
  await until(() => h!.frame().includes("second-agent-ready"))
  expect(h!.frame()).toContain("⎇ SECOND-2")
  expect(existsSync(worktreeFor(root, "second", 2).path)).toBe(true)
})

test("a CLI that opens with a question brings focus to the AI pane, even when it then goes quiet", async () => {
  const ws = createWorkspace(await fixture({ "a.txt": "a" }), { focus: "editor" }, editorShown())
  const asks: AiConfig = {
    command: "/bin/sh",
    // Lots of output first (scans are throttled), then the question as the very last thing.
    args: ["-c", "for i in $(seq 1 200); do echo line $i; done; printf 'Do you trust this folder?'; exec cat"],
    maxScrollbackBytes: 100_000,
    notify: "off",
    agents: [],
  }
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={asks} /> }, { width: 140, height: 24 })
  await until(() => ws.ui.get().focus === "ai")
  expect(ws.ui.get().focus).toBe("ai")
  expect(ws.ui.get().notice?.text).toContain("asking a question")
})

test("a worktree agent whose tab closed can be resumed from the + menu", async () => {
  const { ws, wt } = await worktreeAgent()
  const id = ws.agents!.activeId()
  // Closed without removing the worktree (or ce restarted): the folder and branch stay.
  await h!.step(() => ws.agents!.close(id))
  await until(() => !h!.frame().includes("⎇ SECOND-1"))
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  await h!.step(() => menuItem(ws, "Resume second ⎇ copane/second-1").run())
  await until(() => h!.frame().includes("SECOND ⎇ SECOND-1") && h!.frame().includes("second-agent-ready"))
  const resumed = ws.agents!.session(ws.agents!.activeId())!
  expect(resumed.branch).toBe("copane/second-1")
  // git names the folder by its real path (macOS: /var is /private/var).
  expect(realpathSync(resumed.cwd)).toBe(realpathSync(wt.cwd))
  // Open again: no longer offered.
  await h!.step(() => ws.agents!.openMenu())
  await until(() => ws.ui.get().modal?.kind === "menu")
  const modal = ws.ui.get().modal as { items: MenuItem[] }
  expect(modal.items.some((i) => i.label.startsWith("Resume"))).toBe(false)
})

test("git worktree list --porcelain: each folder and its branch", () => {
  const out =
    "worktree /p/app\nHEAD 1111\nbranch refs/heads/main\n\nworktree /p/app-claude-4\nHEAD 2222\nbranch refs/heads/copane/claude-4\n\nworktree /p/x\nHEAD 3333\ndetached\n"
  expect(parseWorktrees(out)).toEqual([
    { path: "/p/app", branch: "main" },
    { path: "/p/app-claude-4", branch: "copane/claude-4" },
    { path: "/p/x", branch: null },
  ])
})

test("many tabs clip, but + and the maximize button stay visible at the right of the header", async () => {
  const root = await fixture({ "a.txt": "a" })
  const ws = await pane(root)
  for (let i = 0; i < 8; i++) {
    await h!.step(() => ws.agents!.openMenu())
    await until(() => ws.ui.get().modal?.kind === "menu")
    await h!.step(() => menuItem(ws, "New second").run())
  }
  await until(() => (h!.frame().match(/SECOND/g) ?? []).length >= 3)
  expect(h!.lines()[0]!.trimEnd()).toMatch(/\+\s+⤢$/)
})

test("a claude tab starts its own conversation (--session-id)", async () => {
  const root = await fixture({ "bin/claude": '#!/bin/sh\necho "claude args:$*"\nexec cat\n' })
  chmodSync(join(root, "bin/claude"), 0o755)
  const before = Bun.env.CLAUDE_CONFIG_DIR
  Bun.env.CLAUDE_CONFIG_DIR = join(root, "no-claude-home")
  try {
    const ws = createWorkspace(root, {}, editorShown())
    const claude: AiConfig = { ...config(), command: join(root, "bin/claude"), args: [] }
    h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={claude} /> }, { width: 240, height: 24 })
    const id = ws.agents!.snapshot()!.tabs[0]!.claudeSession!
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    await until(() => h!.frame().includes(`claude args:--session-id ${id}`))
  } finally {
    Bun.env.CLAUDE_CONFIG_DIR = before
  }
})

test("tabs open before a restart come back: each claude tab in its conversation, a dev server running again", async () => {
  const root = await fixture({ "web/package.json": "{}" })
  const saved1 = "aaaaaaaa-1111-4222-8333-944445555666"
  const fresh2 = "bbbbbbbb-1111-4222-8333-944445555666"
  const home = await fixture({ [`projects/-work/${saved1}.jsonl`]: "{}\n" })
  const before = Bun.env.CLAUDE_CONFIG_DIR
  Bun.env.CLAUDE_CONFIG_DIR = home
  try {
    // Stand-ins for claude that print the args they got ($0 is the tab's name).
    const agent = (name: string) => ({
      name,
      command: "/bin/sh",
      args: ["-c", 'echo "$0 args:$*"; exec cat', name],
      cwd: root,
      branch: null,
    })
    const web = {
      name: "web",
      command: "/bin/sh",
      args: [],
      cwd: join(root, "web"),
      branch: null,
      terminal: { run: "echo web-is-up" },
    }
    const tabs = [{ ...agent("one"), claudeSession: saved1 }, { ...agent("two"), claudeSession: fresh2 }, web]
    // A worktree removed meanwhile: its tab stays closed.
    const restored = await restorableTabs({ tabs: [...tabs, { ...agent("gone"), cwd: join(root, "removed") }], active: 1 })
    expect(restored).toEqual({ tabs, active: 1 })

    const ws = createWorkspace(root, {}, editorShown())
    h = await renderApp(
      ws,
      { tree: <text>TREE</text>, ai: <TerminalPane config={config()} restored={restored} /> },
      { width: 240, height: 24 },
    )
    // The shown tab: never talked to, so a new conversation under its id.
    await until(() => h!.frame().includes(`two args:--session-id ${fresh2}`))
    expect(ws.agents!.snapshot()).toEqual({ tabs, active: 1 })
    await h!.step(() => ws.agents!.cycle(-1))
    await until(() => h!.frame().includes(`one args:--resume ${saved1}`))
    await h!.step(() => ws.agents!.cycle(-1))
    await until(() => h!.lines().some((l) => l.includes("web-is-up") && !l.includes("echo")))
  } finally {
    Bun.env.CLAUDE_CONFIG_DIR = before
  }
})
