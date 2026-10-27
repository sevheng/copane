import { firstAddedLine } from "../../src/git/SourceControlPanel"
import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { MouseButtons } from "@opentui/core/testing"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepos } from "../../src/git/repos"
import { Store } from "../../src/app/store"
import { openOver } from "../../src/app/modalStack"
import { readFileSync } from "node:fs"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

const ENV = GIT_ENV
let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})

function sh(cwd: string, ...args: string[]) {
  // The test polls `git status` while the app commits: without this its own reads would take
  // .git/index.lock and make the app's commit fail (as they did on slow macOS runners).
  return Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...ENV, GIT_OPTIONAL_LOCKS: "0" },
  }).stdout.toString()
}

const until = (cond: () => boolean | Promise<boolean>, ms = 3000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

async function setup() {
  const root = await fixture({ "a.ts": "one\ntwo\n", "b.ts": "keep\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  writeFileSync(join(root, "a.ts"), "one\nTWO by ai\n")
  writeFileSync(join(root, "new.ts"), "fresh\n")
  Object.assign(process.env, ENV)
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = GitRepos.single(git)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await h.step(() => h!.keys.pressKey("d", { ctrl: true, meta: true }))
  await until(() => /\+ +TWO by ai/.test(h!.frame()))
  return { ws, root }
}

test("panel lists changes with a diff; Space stages; message + Enter commits", async () => {
  const { root } = await setup()
  const f = h!.frame()
  expect(f).toContain("Source control")
  expect(f).toContain("Changes (2)")
  expect(f).toContain("a.ts")
  expect(f).toMatch(/\+ +TWO by ai/)
  // The list has focus when nothing is staged; stage a.ts.
  await h!.step(() => h!.keys.pressKey(" "))
  await until(() => h!.frame().includes("Staged (1)"))
  expect(h!.frame()).toContain("Staged (1)")
  // Write a message and commit with Enter.
  await h!.step(() => h!.keys.pressKey("c"))
  await h!.step(() => h!.keys.typeText("Update a"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => sh(root, "log", "--format=%s").startsWith("Update a"))
  expect(sh(root, "log", "--format=%s").split("\n")[0]).toBe("Update a")
  await until(() => !h!.frame().includes("Staged ("))
  expect(h!.frame()).toContain("Changes (1)") // new.ts is still untracked
})

test("commit with nothing staged offers to stage all; y commits everything", async () => {
  const { root } = await setup()
  await h!.step(() => h!.keys.pressKey("c"))
  await h!.step(() => h!.keys.typeText("All of it"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => h!.frame().includes("Stage all changes and commit?"))
  await h!.step(() => h!.keys.pressKey("y"))
  await until(() => sh(root, "status", "--porcelain") === "")
  expect(sh(root, "status", "--porcelain")).toBe("")
  await until(() => h!.frame().includes("Working tree clean"))
  expect(h!.frame()).toContain("Working tree clean")
  expect(h!.frame()).toContain("Committed")
})

test("r + y reverts the selected file", async () => {
  const { root } = await setup()
  await h!.step(() => h!.keys.pressKey("r"))
  expect(h!.frame()).toContain("Discard all changes to a.ts?")
  await h!.step(() => h!.keys.pressKey("y"))
  await until(() => !sh(root, "status", "--porcelain").includes("a.ts"))
  expect(Bun.file(join(root, "a.ts")).text()).resolves.toBe("one\ntwo\n")
})

test("push without a remote explains it", async () => {
  await setup()
  await h!.step(() => h!.keys.pressKey("p", { shift: true }))
  await until(() => h!.frame().includes("No remote configured"))
  expect(h!.frame()).toContain("No remote configured")
})

test("AI message: asks the configured claude with the staged diff and fills the message", async () => {
  const { aiCommitMessage } = await import("../../src/git/SourceControlPanel")
  const { configSchema } = await import("../../src/config/schema")
  const { GitRepo } = await import("../../src/git/repo")
  const root = await fixture({ "a.ts": "one\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  writeFileSync(join(root, "a.ts"), "two\n")
  sh(root, "add", ".")
  // A stand-in "claude": checks it got -p and the diff on stdin, prints a message.
  const bin = join(root, ".bin")
  Bun.spawnSync(["mkdir", "-p", bin])
  writeFileSync(join(bin, "claude"), '#!/bin/sh\n[ "$1" = "-p" ] || exit 2\ngrep -q "+two" || exit 3\necho "Change a to two"\n')
  Bun.spawnSync(["chmod", "+x", join(bin, "claude")])
  const ws = createWorkspace(root, {}, configSchema.parse({ ai: { command: join(bin, "claude") } }))
  ws.git = { repo: new GitRepo(root) } as never
  expect(await aiCommitMessage(ws)).toBe("Change a to two")
  const other = createWorkspace(root, {}, configSchema.parse({ ai: { command: "codex" } }))
  other.git = ws.git
  expect(await aiCommitMessage(other)).toEqual({ error: "AI messages need claude as ai.command (now codex)" })
})

/** A committed repo with `files`, then `changes` written on top, and the panel open. */
async function panel(
  files: Record<string, string>,
  changes: Record<string, string>,
  opts: {
    size?: { width: number; height: number }
    ws?: (ws: ReturnType<typeof createWorkspace>) => void
    before?: (root: string) => void
  } = {},
) {
  const root = await fixture(files)
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  opts.before?.(root)
  for (const [f, text] of Object.entries(changes)) writeFileSync(join(root, f), text)
  Object.assign(process.env, ENV)
  const ws = createWorkspace(root)
  opts.ws?.(ws)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = GitRepos.single(git)
  h = await renderApp(ws, { tree: <text>TREE</text> }, opts.size)
  await h.step(() => h!.keys.pressKey("d", { ctrl: true, meta: true }))
  await until(() => h!.frame().includes("Source control"))
  return { ws, root }
}
const press = (k: string, mods?: { shift?: boolean }) => h!.step(() => h!.keys.pressKey(k, mods))
const lines30 = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n"

test("after staging, the selection moves to the next file in the same section, not an unrelated one", async () => {
  await panel({ "c1.ts": "1\n", "c2.ts": "2\n", "c3.ts": "3\n" }, { "c1.ts": "x\n", "c2.ts": "y\n", "c3.ts": "z\n" })
  await until(() => h!.frame().includes("Changes (3)"))
  await press("j") // c2
  await until(() => h!.frame().includes("c2.ts  unstaged"))
  await press(" ")
  await until(() => h!.frame().includes("Staged (1)"))
  await until(() => h!.frame().includes("c3.ts  unstaged"))
  expect(h!.frame()).toContain("c3.ts  unstaged")
})

test("rows show name, folder, +/− counts and the AI mark", async () => {
  await panel(
    { "src/deep/a.ts": "one\ntwo\n" },
    { "src/deep/a.ts": "one\nTWO\nthree\n" },
    {
      ws: (ws) => {
        const path = join(ws.root, "src/deep/a.ts")
        ws.review = { store: new Store({ version: 1 }), files: () => [path] } as never
      },
    },
  )
  await until(() => h!.frame().includes("+2 −1"))
  const row = h!.lines().find((l) => l.includes("a.ts  src/deep"))
  expect(row).toBeDefined()
  expect(row).toContain("✦")
  expect(row).toContain("+2 −1")
})

test("a stages all, A unstages all", async () => {
  await panel({ "a.ts": "a\n", "b.ts": "b\n" }, { "a.ts": "A\n", "b.ts": "B\n" })
  await press("a")
  await until(() => h!.frame().includes("Staged (2)"))
  await press("a", { shift: true })
  await until(() => !h!.frame().includes("Staged (") && h!.frame().includes("Changes (2)"))
  expect(h!.frame()).toContain("Changes (2)")
})

test("a multi-line AI message is kept whole in the commit", async () => {
  const { configSchema } = await import("../../src/config/schema")
  const { root } = await panel(
    { "a.ts": "a\n" },
    { "a.ts": "b\n" },
    {
      before: (root) => {
        const bin = join(root, ".bin")
        Bun.spawnSync(["mkdir", "-p", bin])
        writeFileSync(join(bin, "claude"), '#!/bin/sh\ncat >/dev/null\nprintf "Change a to b\\n\\nBecause b is better.\\n"\n')
        Bun.spawnSync(["chmod", "+x", join(bin, "claude")])
        writeFileSync(join(root, ".git/info/exclude"), ".bin\n")
      },
      ws: (ws) => Object.assign(ws, { config: configSchema.parse({ ai: { command: join(ws.root, ".bin/claude") } }) }),
    },
  )
  await press(" ")
  await until(() => h!.frame().includes("Staged (1)"))
  await press("m")
  await until(() => h!.frame().includes("Because b is better."))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => sh(root, "log", "-1", "--format=%s") === "Change a to b\n")
  expect(sh(root, "log", "-1", "--format=%B").trim()).toBe("Change a to b\n\nBecause b is better.")
})

test("in the diff, ] picks the next change and Space stages only that one", async () => {
  const changed = lines30.replace("line 1\n", "LINE 1\n").replace("line 25\n", "LINE 25\n")
  const { root } = await panel({ "a.txt": lines30 }, { "a.txt": changed })
  await until(() => h!.frame().includes("change 1/2"))
  await press("l") // into the diff, first change
  await press("]")
  await until(() => h!.frame().includes("change 2/2"))
  // The selected change is marked and scrolled into view.
  const marked = h!.lines().find((l) => l.includes("◂")) ?? ""
  expect(marked).toMatch(/@@ -2\d/)
  expect(h!.frame()).toMatch(/\+ +LINE 25/)
  await press(" ")
  await until(() => sh(root, "diff", "--cached").includes("+LINE 25"))
  const staged = sh(root, "diff", "--cached")
  expect(staged).toContain("+LINE 25")
  expect(staged).not.toContain("+LINE 1\n")
  expect(sh(root, "diff")).toContain("+LINE 1")
})

test("right-click on a file opens a menu; Stage stages it and the panel comes back", async () => {
  const { root } = await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await until(() => h!.frame().includes("Changes (1)"))
  const at = h!.find(" M a.ts")
  await h!.step(() => h!.mouse.click(at.x + 3, at.y, MouseButtons.RIGHT))
  await until(() => h!.frame().includes("Discard changes…"))
  await h!.step(() => h!.mouse.click(h!.find("Stage").x, h!.find("Stage").y))
  await until(() => sh(root, "diff", "--cached", "--name-only").trim() === "a.ts")
  await until(() => h!.frame().includes("Staged (1)"))
  expect(h!.frame()).toContain("Source control")
})

test("dismissing the right-click menu (Escape or a click outside) keeps the panel open", async () => {
  await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await until(() => h!.frame().includes("Changes (1)"))
  const rightClick = async () => {
    const at = h!.find(" M a.ts")
    await h!.step(() => h!.mouse.click(at.x + 3, at.y, MouseButtons.RIGHT))
    await until(() => h!.frame().includes("Discard changes…"))
    // The panel stays under the menu.
    expect(h!.frame()).toContain("Changes (1)")
  }
  await rightClick()
  await h!.step(() => h!.keys.pressEscape())
  await until(() => !h!.frame().includes("Discard changes…"))
  expect(h!.frame()).toContain("Changes (1)")
  await rightClick()
  await h!.step(() => h!.mouse.click(1, 1))
  await until(() => !h!.frame().includes("Discard changes…"))
  expect(h!.frame()).toContain("Changes (1)")
  // Keys reach the panel again: Escape closes it.
  await h!.step(() => h!.keys.pressEscape())
  await until(() => !h!.frame().includes("Changes (1)"))
})

test("Branches (b) and a file's history, opened from the panel, show above it and go back to it on Escape", async () => {
  const { ws } = await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await until(() => h!.frame().includes("Changes (1)"))
  await press("b")
  await until(() => h!.frame().includes("Switch branch"))
  // The panel stays on screen under the picker.
  expect(h!.frame()).toContain("Changes (1)")
  await h!.step(() => h!.keys.pressEscape())
  await until(() => !h!.frame().includes("Switch branch"))
  expect(h!.frame()).toContain("Changes (1)")

  const at = h!.find(" M a.ts")
  await h!.step(() => h!.mouse.click(at.x + 3, at.y, MouseButtons.RIGHT))
  await until(() => h!.frame().includes("File history"))
  await h!.step(() => h!.mouse.click(h!.find("File history").x, h!.find("File history").y))
  await until(() => h!.frame().includes("copy sha"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => !h!.frame().includes("copy sha"))
  expect(ws.ui.get().modal?.kind).toBe("scm")
})

test("History (g) lists the project's commits, and Escape goes back to the panel", async () => {
  await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await until(() => h!.frame().includes("History (g)"))
  await h!.step(() => h!.mouse.click(h!.find("History (g)").x, h!.find("History (g)").y))
  await until(() => h!.frame().includes("History: repository (1)"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => h!.frame().includes("Changes (1)"))
  await press("g")
  await until(() => h!.frame().includes("History: repository (1)"))
})

test("a clean tree says so, with commits to push and the last commit", async () => {
  await panel(
    { "a.ts": "a\n" },
    {},
    {
      before: (root) => {
        const remote = join(root, "..", `${root.split("/").pop()}-remote.git`)
        sh(root, "init", "-q", "--bare", remote)
        sh(root, "remote", "add", "origin", remote)
        sh(root, "push", "-q", "-u", "origin", "main")
        writeFileSync(join(root, "a.ts"), "b\n")
        sh(root, "commit", "-qam", "Local only")
      },
    },
  )
  // Ahead/behind and the last commit load separately: wait for both.
  await until(() => h!.frame().includes("↑1 to push") && h!.frame().includes("Last commit: Local only"))
  expect(h!.frame()).toContain("Working tree clean · ↑1 to push (P)")
  expect(h!.frame()).toContain("Last commit: Local only")
})

test("with more files than fit, the selected row stays on screen", async () => {
  const files: Record<string, string> = {}
  const changes: Record<string, string> = {}
  for (let i = 0; i < 30; i++) {
    const name = `f${String(i).padStart(2, "0")}.ts`
    files[name] = `${i}\n`
    changes[name] = `changed ${i}\n`
  }
  await panel(files, changes, { size: { width: 120, height: 24 } })
  await until(() => h!.frame().includes("Changes (30)"))
  for (let i = 0; i < 29; i++) await press("j")
  await until(() => h!.frame().includes("f29.ts  unstaged"))
  // In the list (with its counts), not just the diff's header.
  expect(h!.lines().some((l) => /f29\.ts\s+\+1 −1/.test(l))).toBe(true)
})

test("a push keeps showing in the status bar after the panel closes, and its result comes as a notice", async () => {
  await panel(
    { "a.ts": "a\n" },
    {},
    {
      before: (root) => {
        const remote = join(root, "..", `${root.split("/").pop()}-remote.git`)
        sh(root, "init", "-q", "--bare", remote)
        sh(root, "remote", "add", "origin", remote)
        sh(root, "push", "-q", "-u", "origin", "main")
        writeFileSync(join(root, "a.ts"), "b\n")
        sh(root, "commit", "-qam", "Local only")
        // Now the remote answers slowly, then refuses.
        const ssh = join(root, ".git", "slow-ssh.sh")
        writeFileSync(ssh, "#!/bin/sh\nsleep 1\necho 'remote: no thanks' >&2\nexit 1\n")
        Bun.spawnSync(["chmod", "+x", ssh])
        sh(root, "remote", "set-url", "origin", "ssh://example.invalid/x.git")
        sh(root, "config", "core.sshCommand", ssh)
      },
    },
  )
  await until(() => h!.frame().includes("↑1 to push"))
  await press("p", { shift: true })
  await until(() => h!.frame().includes("Pushing…"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => !h!.frame().includes("Source control"))
  const bottom = () =>
    h!
      .lines()
      .filter((l) => l.trim())
      .at(-1) ?? ""
  expect(bottom()).toContain("Pushing…")
  await until(() => !bottom().includes("Pushing…"), 8000)
  expect(bottom()).toMatch(/no thanks|Could not read|fatal/)
})

test("several repositories: a tab each; staging and committing act on the one shown; the status bar follows the open file", async () => {
  const root = await fixture({ "front/a.ts": "a\n", "back/b.ts": "b\n" })
  for (const d of ["front", "back"]) {
    sh(join(root, d), "init", "-q", "-b", "main")
    sh(join(root, d), "add", ".")
    sh(join(root, d), "commit", "-qm", "init")
  }
  writeFileSync(join(root, "front/a.ts"), "a changed\n")
  writeFileSync(join(root, "back/b.ts"), "b changed\n")
  Object.assign(process.env, ENV)
  const ws = createWorkspace(root)
  const repos = new GitRepos(root, { activePath: () => ws.buffers.active?.path ?? null })
  await repos.start(50)
  ws.git = repos
  try {
    await ws.buffers.open("front/a.ts")
    h = await renderApp(ws, { tree: <text>TREE</text> })
    await until(() => h!.frame().includes("front main"))
    // Opened from the editor: the open file's repository.
    await h.step(() => h!.keys.pressKey("d", { ctrl: true, meta: true }))
    await until(() => /\+ +a changed/.test(h!.frame()))
    expect(h.frame()).toContain("Source control  front")
    expect(h.frame()).toContain("back 1")
    await h.step(() => h!.keys.pressKey(" "))
    await until(() => sh(join(root, "front"), "diff", "--cached", "--name-only").includes("a.ts"))
    expect(sh(join(root, "back"), "diff", "--cached", "--name-only")).toBe("")
    await h.step(() => h!.keys.pressKey("c"))
    await h.step(() => h!.keys.typeText("front only"))
    await h.step(() => h!.keys.pressEnter())
    await until(() => sh(join(root, "front"), "log", "--oneline").includes("front only"))
    expect(sh(join(root, "back"), "log", "--oneline")).not.toContain("front only")
    // n: the next repository's tab.
    // A lone Esc then n would read as Alt+N (ESC n): wait for the Esc to land first.
    await h.step(() => h!.keys.pressEscape())
    await until(() => h!.frame().includes("(c or Tab to write)"))
    await h.step(() => h!.keys.pressKey("n"))
    await until(() => /\+ +b changed/.test(h!.frame()))
    expect(h.frame()).toContain("Source control  back")
  } finally {
    repos.stop()
  }
})

test("the Discard confirm opened from the panel's menu: Escape, a click outside and Cancel return to the panel", async () => {
  const { root } = await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await until(() => h!.frame().includes("Changes (1)"))
  const askDiscard = async () => {
    const at = h!.find(" M a.ts")
    await h!.step(() => h!.mouse.click(at.x + 3, at.y, MouseButtons.RIGHT))
    await until(() => h!.frame().includes("Discard changes…"))
    await h!.step(() => h!.mouse.click(h!.find("Discard changes…").x, h!.find("Discard changes…").y))
    await until(() => h!.frame().includes("Discard all changes to a.ts?"))
  }
  const backInPanel = async () => {
    await until(() => !h!.frame().includes("Discard all changes to a.ts?"))
    expect(h!.frame()).toContain("Changes (1)")
  }
  await askDiscard()
  await h!.step(() => h!.keys.pressEscape())
  await backInPanel()
  await askDiscard()
  await h!.step(() => h!.mouse.click(1, 1))
  await backInPanel()
  await askDiscard()
  await press("c")
  await backInPanel()
  // Discard itself: done, and the panel is still there.
  await askDiscard()
  await press("d")
  await until(() => readFileSync(join(root, "a.ts"), "utf8") === "a\n")
  await until(() => !h!.frame().includes("Changes (1)"))
  expect(h!.frame()).toContain("Source control")
})

test("Stage from the panel's menu: the panel stays on screen the whole time", async () => {
  const { root } = await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await until(() => h!.frame().includes("Changes (1)"))
  const at = h!.find(" M a.ts")
  await h!.step(() => h!.mouse.click(at.x + 3, at.y, MouseButtons.RIGHT))
  await until(() => h!.frame().includes("Discard changes…"))
  await h!.step(() => h!.mouse.click(h!.find("Stage").x, h!.find("Stage").y))
  await waitUntil(async () => {
    await h!.setup.renderOnce()
    expect(h!.frame()).toContain("Source control")
    return sh(root, "diff", "--cached", "--name-only").trim() === "a.ts" && h!.frame().includes("Staged (1)")
  }, 3000)
})

test("the panel opened over another dialog returns to it on Escape", async () => {
  const { ws } = await panel({ "a.ts": "a\n" }, { "a.ts": "b\n" })
  await h!.step(() => ws.ui.set({ modal: { kind: "help" } }))
  await until(() => h!.frame().includes("Shortcuts"))
  await h!.step(() => openOver(ws, { kind: "scm" }))
  await until(() => h!.frame().includes("Changes (1)"))
  await h!.step(() => h!.keys.pressEscape())
  await until(() => h!.frame().includes("Shortcuts"))
  expect(ws.ui.get().modal?.kind).toBe("help")
  await h!.step(() => h!.keys.pressEscape())
  await until(() => ws.ui.get().modal === null)
})

test("firstAddedLine: Enter on a file opens at its first added line", () => {
  expect(firstAddedLine("@@ -3,3 +3,4 @@\n a\n-b\n+B\n c")).toBe(3)
  expect(firstAddedLine("@@ -0,0 +1,2 @@ new file\n+x\n+y")).toBe(0)
  expect(firstAddedLine("@@ -5,2 +5,1 @@\n a\n-b")).toBe(0)
})
