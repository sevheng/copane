import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { GitStatus } from "../../src/files/gitStatus"
import { GitRepos } from "../../src/git/repos"
import { splitShow } from "../../src/git/HistoryModal"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil, GIT_ENV } from "../helpers"

setDefaultTimeout(15_000)

let h: Harness | null = null
let git: GitStatus | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  git?.stop()
  h = null
})
const sh = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...GIT_ENV, GIT_OPTIONAL_LOCKS: "0" },
  }).stdout.toString()
const until = (cond: () => boolean, ms = 4000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

test("splitShow: the commit header, then each file's patch; files without hunks keep git's lines", () => {
  const out = [
    "commit abc",
    "Author: A <a@x>",
    "",
    "    subject",
    "",
    " a.ts | 2 +-",
    "diff --git a/a.ts b/a.ts",
    "index 1..2 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/img.png b/img.png",
    "new file mode 100644",
    "index 0000000..3",
    "Binary files /dev/null and b/img.png differ",
    "",
  ].join("\n")
  const s = splitShow(out)
  expect(s.header[0]).toBe("commit abc")
  expect(s.header.at(-1)).toBe(" a.ts | 2 +-")
  expect(s.files.map((f) => f.path)).toEqual(["a.ts", "img.png"])
  expect(s.files[0]!.patch).toContain("@@ -1 +1 @@\n-old\n+new")
  expect(s.files[1]!.patch).toBe("")
  expect(s.files[1]!.info).toEqual(["new file mode 100644", "Binary files /dev/null and b/img.png differ"])
})

test("a commit shows its message and each file as a diff; PgDn scrolls", async () => {
  const many = Array.from({ length: 60 }, (_, i) => `export const v${i} = ${i}`)
  const root = await fixture({ "a.ts": many.join("\n") + "\n" })
  sh(root, "init", "-q", "-b", "main")
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "init")
  await Bun.write(join(root, "a.ts"), many.map((l, i) => (i % 3 ? l : l + " // changed")).join("\n") + "\n")
  await Bun.write(join(root, "img.bin"), new Uint8Array([0, 1, 2, 0, 255]))
  sh(root, "add", ".")
  sh(root, "commit", "-qm", "change things")
  const sha = sh(root, "rev-parse", "HEAD").trim()
  const ws = createWorkspace(root)
  git = new GitStatus(root)
  await git.start(50)
  ws.git = GitRepos.single(git)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await h.step(() => ws.ui.set({ modal: { kind: "history", path: null, sha } }))
  await until(() => h!.frame().includes("change things") && h!.frame().includes("export const v0 = 0 // changed"))
  let f = h.frame()
  expect(f).toContain(`commit ${sha}`)
  expect(f).toMatch(/- *export const v0 = 0\b/)
  expect(f).toMatch(/\+ *export const v0 = 0 \/\/ changed/)
  expect(f).not.toContain("Binary files")
  for (let i = 0; i < 8; i++) await h.step(() => h!.keys.pressKey(" "))
  await until(() => h!.frame().includes("Binary files"))
  f = h.frame()
  expect(f).toContain("img.bin")
  expect(f).not.toContain(`commit ${sha}`)
})
