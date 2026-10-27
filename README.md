<div align="center">

# copane

**Your editor and your AI coding agent, side by side in one terminal.**

A fast code editor, at home with the keyboard and the mouse, with Claude Code (or any AI CLI) living in the next pane:
ask for a change, watch it land in your buffer, review the diff, keep it or undo it.

[![Release](https://img.shields.io/github/v/release/sevheng/copane)](https://github.com/sevheng/copane/releases/latest)
[![CI](https://github.com/sevheng/copane/actions/workflows/ci.yml/badge.svg)](https://github.com/sevheng/copane/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20WSL-lightgrey)

</div>

![copane demo: Claude fixes a bug in the side pane, the editor reloads it, and the change is reviewed as a diff](docs/demo.gif)

## Why copane?

AI agents edit your files from a terminal, but you still need an editor to see, steer and check
their work. Usually that means juggling two apps. copane puts both in one window and wires them together:

- **🤖 The real CLI, not a wrapper.** The AI pane is a true terminal running Claude Code, so you keep
  every feature: tools, approvals, slash commands, sessions. Swap in `codex`, `opencode`, `gemini` or your shell.
- **⚡ Context in one key.** Select code and press **Ctrl+L**: the agent gets `@file#L10-20` and the snippet.
- **👀 See every change.** Files the agent edits reload live, changed lines flash, the gutter marks
  what differs from git, and **Ctrl+Alt+D** reviews every change with a diff. **Ctrl+Z** undoes the agent's edit.
- **🔀 No lost work.** Typing while the agent edits the same file? Merge both, compare, or pick a side.
- **🧠 A real editor.** Language servers (TypeScript, Vue, Rust, Go, Python, Zig, C/C++), one per package in monorepos, autocomplete,
  go to definition, rename, multi-cursor, Tree-sitter highlighting, project search and replace, Prettier,
  a live Markdown preview, and images right in the terminal.
- **🌿 Git built in.** Stage hunks, commit (with AI-written messages), push, blame, file history,
  branches and merge-conflict resolution.
- **🖱️ Mouse too.** Click, drag to select, drag dividers (double-click resets them), right-click menus everywhere, and a smoothly gliding scroll wheel.
- **⌨️ VS Code keys.** Ctrl+P, F1, Ctrl+D, F12, F2… and **Import VS Code settings** in one step.
- **🚀 Fast and light.** One self-contained binary, instant start in big repos, ~30 ms per keystroke in an 11,000-line file.

## Install

Linux, macOS, or Windows through WSL:

```sh
curl -fsSL https://raw.githubusercontent.com/sevheng/copane/main/install.sh | sh
```

This installs `copane` and a short `ce` alias in `~/.local/bin`, plus the bundled Nerd Font for file-tree icons. No Bun or Node needed.
`VERSION=v0.1.0` pins a release, `PREFIX=/usr/local` installs elsewhere, `ALIAS=cx` (or `ALIAS=`) changes the alias, and `FONT=0` skips the font.
You can also download a binary from [Releases](https://github.com/sevheng/copane/releases/latest).

You'll want [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`) on your PATH, or set another CLI in the [config](#config).

Then open things the way VS Code's `code` does:

```sh
ce                   # the welcome page: pick a recent folder
ce .                 # this folder
ce src/main.ts       # a file (its project folder is the workspace)
ce ~/projects/app    # another folder
```

**Welcome page:** `ce` on its own shows the folders you opened recently, as VS Code's Welcome page does, with each one's git branch and when you last opened it. Click a folder (or ↑↓ Enter, or 1–9) to open it; its **×** (or Delete) removes it from the list. **Open folder…** (`o`) browses: type to filter the folders, click or Enter to go into one, **open** on a row (or Alt+Enter) opens it right away, and Backspace goes up. The button next to it (`.`) opens the folder you're in, or browses it when that is your home folder: `~` isn't a project (the AI would get all of it), so opening `~` or `/` from the page takes a second click, after a warning. If you do open `~`, its hidden entries (`.claude`, `.cache`, `.nvm`, ...) show faded and aren't watched, indexed or scanned for repositories, so tools writing there (the AI's own session logs) don't count as changes. In the editor, **Ctrl+Alt+O** (Open recent folder) shows the same page and switches to the folder you pick, asking first about unsaved files. Set `"startup": { "welcome": false }` for `ce` to open the current folder instead.

**Updating:** copane updates itself. Once a day it checks GitHub for a new release and installs it in the background, so the next time you start `ce` you're on the latest version. Every open editor then shows "⟳ Update installed: restart" in the status bar: click it or press Ctrl+Alt+R and, after asking about unsaved files, the editor restarts on the new version with the same folder and tabs, AI pane tabs included: each Claude tab goes back into its own conversation, and dev servers start again. `ce --upgrade` installs the latest release right away. To choose when to update, set `"update": "notify"` (the status bar says when a release is out, and a click installs it) or `"off"` (never checks).

`ce --version` prints the installed version.

Uninstall: `rm -r ~/.local/bin/copane ~/.local/bin/ce ~/.local/lib/copane`.

### From source

Needs [Bun](https://bun.sh) 1.4.4 or later (`curl -fsSL https://bun.sh/install | bash`).

```sh
git clone https://github.com/sevheng/copane.git
cd copane
bun install
bun run dev                 # open the current directory (or pass a file or folder)
bun run install:cli         # build and install ~/.local/bin/copane + `ce`, plus the bundled Nerd Font
```

`install:cli` takes the same `PREFIX` and `ALIAS` variables. Ctrl+Alt+R restarts `bun run dev`, which picks up source changes.

Built with [Bun](https://bun.sh) and [OpenTUI](https://opentui.com). Linux and macOS only, because it uses Bun's POSIX pseudo-terminal.

## Working with the AI

The editor is built around a loop: ask Claude, see what it changed, keep or undo it.

1. **Give context.** Select lines, or nothing for the whole file, and press **Ctrl+L**. The AI prompt gets `@path#L10-20` plus the snippet. In the tree, right-click a file or folder and choose **Send to AI**.
2. **Ask.** Ctrl+J moves you to the AI pane, and Ctrl+E brings you back. Unsaved files are saved when you switch, so Claude reads what you see. Turn this off with `editor.saveBeforeAi: false`.
3. **See what changed.** Files Claude edits reload automatically, and the changed lines flash. The line numbers mark lines that differ from the last commit: **▎** green added, yellow changed, and a red **▁** for deleted. The tree marks changed files.
4. **Review it in place.** Lines the AI changed get a violet **┃** until you've reviewed them, a bar above the file counts them, and the status bar shows how many files are left. **Alt+N** (or **Ctrl+Alt+V**, which also works from the AI pane) jumps to the next AI change and shows what it replaced: **a** accepts it and moves on, **r** undoes it (Ctrl+Z brings it back), **↑ ↓** step. Past the last change in a file, Alt+N opens the next file. The file tree marks what's left with **✦**, and what the AI is editing right now with **✎**. The bar also has **Accept file**, **Undo file** and **Accept all**. Alt+P goes back. What's left to review is remembered when you quit or restart, and committing a file (yourself or by the AI) accepts its AI changes, so marks never pile up.
5. **Review everything.** **Ctrl+Alt+D** lists all changed files with a diff. **Enter** opens a file at the change, and **r** reverts it.
   - **Turn by turn (Ctrl+Alt+Z):** each prompt you send becomes a turn that lists the files the AI changed, with +/− counts and each change since before the turn. **u** undoes the whole turn (asking first if you've edited those files since), **x** one file, **r** one change. Files the AI created are removed. It works with any CLI, because it watches files, not the CLI.
6. **Undo.** Ctrl+Z also undoes a reload, so you can step back through Claude's edit in the editor.
7. **Edits on both sides.** When Claude changes a file you have unsaved edits in, a bar offers:
   - **Merge both:** keeps your edits and Claude's. Only offered when they don't touch the same lines.
   - **Compare:** shows the two versions side by side as a diff.
   - **Use disk:** takes Claude's version.
   - **Keep mine:** keeps yours, and your next save overwrites Claude's.

**One-click requests:** right-click in the editor, or use F1, for **AI: explain this**, **AI: find and fix bugs**, or **AI: write tests**. Each sends the selection, or the whole file, together with the request, and submits it.

**Hand over problems and changes.** These type a ready prompt into the AI pane and leave submitting to you:
- **Ctrl+K F, fix problems:** the language server's errors and warnings, as `@file#L12 error: …`, for the current file (or every open file when it has none). Also `f` in the Problems list (Ctrl+Alt+E), and **Ask AI to fix** in the quick-fix menu (Alt+.) for the line you're on.
- **Ctrl+K D, review changes:** your git diff (the staged changes if any, otherwise everything uncommitted, plus new files) with "review these for bugs". Also `v` in Source control. A diff too big to paste is sent as the list of changed files.

Run commands from the AI pane with `!`, for example `! bun test`.

**Terminals and dev servers.** **+** in the AI pane's header opens a new tab: an agent, a terminal, or a dev server.
- **New terminal** (**+**, or **Alt+`**): your shell in a tab beside the agents. `exit` closes it.
- **▶ Run …:** each package's dev server, one click. **+** lists every package's dev script (`dev`, `start:dev`, `serve` or `watch`, run with npm, pnpm, yarn or bun by its lockfile) down to three folders deep, and `docker compose up` when there's a compose file. A monorepo with `packages/backend` and `packages/ui-admin` gets both with no setup. Running one opens a terminal in that package and types the command, so Ctrl+C stops it and ↑ Enter runs it again. List your own instead: `"ai": { "services": [{ "name": "api", "command": "uvicorn main:app --reload", "cwd": "backend" }] }`.
- **Errors:** every terminal tab watches its output. A compile error, stack trace or crash turns its `●` into `✗`, and while you're elsewhere a notice says so. The header shows **✗ Fix with AI** (or press **Ctrl+K E** anywhere): the error, and the project file and line it points to (`@src/app.service.ts#L12`), go into the agent's prompt, unsent. A rebuild, a restart or your next command clears it.
- **Text for the AI never reaches a terminal:** Ctrl+L and the other "send to AI" keys go to an agent tab even when a terminal is showing.
- **Links:** Ctrl+click (or Alt+click) a `file:line` in any AI pane tab to open it at that line, or an `http://` address to open it in the browser.
- **↻** on a dev server's tab restarts it (a fresh shell running its command again); Ctrl+C stops it. Terminals stop when `ce` quits. After a restart (Ctrl+Alt+R, or an update) the terminal tabs come back: dev servers run their command again, and other terminals open a fresh shell in the same folder.
- **Right-click** in the AI pane copies the selection, or pastes when nothing is selected (as VS Code's terminal on Windows). There is no menu: every action has a button or a key.

**Several agents.** **Ctrl+Alt+N** (or **+ new** in the AI pane's header) starts another CLI in a new tab, such as a second Claude for another task, or Codex beside Claude. Each Claude tab has its own conversation (copane starts it with `--session-id`), so a restart of `ce` brings every tab back into its own conversation (`--resume`), and so does Enter after you exit Claude (`/clear` starts a fresh one). Each tab keeps running while hidden, and its header shows whether it's working, done or waiting for you. **Ctrl+Alt+PageDown / PageUp** switch tabs, and Ctrl+L and the other "send to AI" keys go to the visible one. Close a tab with its **×**, a middle-click, or **Ctrl+Alt+W** in the AI pane. Pick **…in a git worktree** to give an agent its own checkout (`../<project>-<agent>-1` on branch `copane/<agent>-1`), so parallel agents never edit the same files. Its tab shows how many files it changed (`⎇ copane/claude-1 · 3`). When it's done, click that count on its tab (or "AI: review & merge" in the palette) lists every file it changed, committed or not, with diffs: **m** merges it into your branch (its leftover edits are committed first; conflicts get the usual conflict bar; if your own uncommitted edits touch the same files, it names them and offers **c** to commit them and merge, or **s** for Source control), **d** throws the work away with its worktree and branch. Closing a worktree tab offers the same review first, or to remove the worktree while keeping its branch. A worktree kept after its tab closed (or after a restart) shows in **+** as **Resume claude ⎇ copane/claude-4**: it opens as its agent tab again, and Claude continues its last conversation there (`--continue`). List extra CLIs in the config: `"ai": { "agents": [{ "name": "codex", "command": "codex" }] }`.

**Look away while it works.** When the AI finishes, or stops to ask you something (an approval prompt), while you're in the editor or another window, copane tells you:
- a notice ("claude finished" / "claude is waiting for your answer")
- the terminal bell (Windows Terminal flashes the taskbar)
- **✓ done** / **⚠ needs you** in the AI pane header and the status bar, until you look (Ctrl+J)

With `"ai": { "notify": "desktop" }` you also get a system notification: a Windows toast on WSL, Notification Center on macOS, `notify-send` on Linux. `"off"` turns it all off.

## Your work is safe

- **Errors don't close the editor.** An internal error shows as a notice, your unsaved changes are backed up and come back on the next start (Ctrl+Z drops them), and the details go to `~/.local/state/copane/errors.log`. A drawing error offers Ctrl+R to redraw the editor with every file as it was. If copane can't write `~/.local/state/copane` (a folder left owned by root, say), a notice at startup says so and how to fix it.
- **Saving never overwrites a change you haven't seen.** If a file changed on disk without the editor noticing (the file watcher can miss changes on WSL drives), Ctrl+S asks whether to overwrite or compare, and **Save all** lists the files that need a decision.
- **Encodings stay intact.** Files that aren't UTF-8 aren't opened (saving would corrupt their accented characters), a UTF-8 byte-order mark is kept, and files with control characters (form feeds…) show a warning and ask before saving.

## Big projects

- **Ctrl+P:** an empty query lists recently opened files first. The file index is built in the background at startup, so the first Ctrl+P is instant.
  - **`@name`:** jumps to a symbol in this file, using the language server or, without one, a pattern scan that also finds `describe`/`it` test blocks.
  - **`#name`:** searches symbols across the project, through the language server.
  - **`:120`:** goes to a line.
- **Ctrl+Alt+← / →:** back and forward through your jumps (definition, references, search results, go to line, picker).
- **Smooth scrolling:** the mouse wheel and PageUp/PageDown glide, in the editor and the Markdown preview, so your eyes can follow where the text goes. A key stops the motion at once, so typing never waits. `editor.smoothScrolling: false` makes scrolling jump instead.
- **Long files:** stay responsive. Syntax colours and indent guides are computed for the whole file, but only lines near the screen are drawn. An 11,000-line file takes about 30 ms per keystroke.
- **`CE_PERF=/tmp/ce-perf.log ce`:** logs how long each keypress takes to reach the screen.
- **Memory:** each `ce` window is its own process (one crashing never takes another down). An idle window uses about 60–90 MB of its own; the program's code is shared between windows. Syntax colouring needs a parser worker, which grows with the files it has read (about 40 MB after a typical file, a few hundred after a very large one), so it stops after a minute without highlighting, or soon after you switch to another app, and starts again on the next edit. The AI CLI in the pane (Claude: 400–500 MB) is usually the biggest part; click the memory figure in the status bar for the breakdown. `CE_MEM=/tmp/ce-mem.log ce` logs memory every 10 s.

## Look

- **Panes:** the panes have no boxes. A thin divider separates them: drag it to resize, double-click it to go back to the default width.
- **Headers:** each pane has one. The left pane has two tabs, `FILES` (the tree) and `SEARCH` (search and replace in all files); click one to switch. The editor's header is its tab row, with icons, and the active tab is accent-coloured while the editor has focus. The AI pane shows the command with `●` while it runs, or a spinner while it's working.
- **Breadcrumbs:** under the tabs, `src › editor › EditorPane.tsx › BufferView` shows the folder path, the file and the symbol under the cursor. Click a folder to show it in the tree.
- **Status bar,** left to right:
  - **Git branch,** with ↑ahead / ↓behind counts. Click it to review changes.
  - **Problems.**
  - **A message or hints.**
  - **Position and selection size.** Click it to go to a line.
  - **Language, line endings and language servers.**
  - **Resource usage,** such as `▤ 1.2G 15%`: memory and CPU of copane plus everything it started (language servers, agents, terminals). CPU is a percentage of one core, so it can pass 100% on several cores. Click it to see what each one uses. **Toggle resource usage** (F1) hides or shows it for the session; `"statusBar": { "resources": false }` turns it off for good.
  - **The AI.** Click it to switch focus.
- **In the editor:**
  - The cursor's line has a slightly lighter background.
  - The bracket matching the one at the cursor is highlighted.
  - Other uses of the word under the cursor get a subtle highlight.
  - Indent levels show as faint guides.
  - Turn these off with `editor.highlightCursor` and `editor.indentGuides`.

## Git

- **Source control (Ctrl+Alt+D,** or click the branch in the status bar**):** merge conflicts, staged files and changed files, with the diff of the selected one. Each file shows its folder, lines added and removed (`+12 −3`), and `✦` when it has AI changes you haven't reviewed. Right-click a file for Open, Stage, Discard, File history and AI review.
  - **Staging:** Space stages or unstages (the selection stays in its section, on the next file), `a` / `A` stage or unstage everything, `r` discards a file's changes and `R` all unstaged changes (both ask first).
  - **Single changes:** → (or Tab) moves into the diff. ↑↓ pick a change, Space stages it (or unstages it in a staged file), and `r` discards it. ← goes back to the files.
  - **Committing:** write a message and press Enter (or Alt+Enter from anywhere in the panel) to commit. Ctrl+J adds a line, for a message with a body. The summary's length shows, in yellow past 72. With nothing staged, it offers to stage everything. **Amend** rewrites the last commit.
  - **AI message (`m`):** asks `claude -p` to write a message from the staged diff. You review it before committing. Turn it off with `git.aiCommitMessage: false`.
  - **History (`g`) and Branch (`b`):** buttons and keys that open the project's commit history or the branch switcher. Esc comes back to the panel.
  - **Push and pull (`P` / `U`):** show progress, also in the status bar next to the branch if you close the panel meanwhile (the result then comes as a notice). A branch without an upstream gets offered "publish". With no remote, it says so.
- **Changes in the editor:**
  - **Markers:** the `▎` markers compare with what's staged, so staged lines lose theirs.
  - **Peek:** **Alt+H**, or a click on a marker, shows the change inline. `s` stages just that change, and `r` reverts it (Ctrl+Z undoes).
  - **Navigation:** **Alt+F5 / Shift+Alt+F5** jump to the next / previous change, as in VS Code.
- **Blame, as in GitLens:**
  - **Inline:** after the cursor's line, dimmed: `Ann, 3 days ago • Fix totals`. Turn it off with `git.inlineBlame: false`.
  - **Status bar:** the same, `Ann · 3 days ago · Fix totals` (`Not committed yet` for your edits). Click it for the commit. Turn it off with `git.blame: false`.
  - **File blame (Alt+B):** a column beside the editor with the author, age and summary of each block of lines, the cursor's commit shaded. It follows scrolling and word wrap. Click a block for its commit; Alt+B again hides it.
- **Ctrl+Alt+G, file history:** the file's commits with their author and age, and each commit's changes. `y` copies a commit id. **Commit history** in the palette (or `g` in Source control) lists the whole project's commits.
- **Ctrl+Alt+B, branches:** switch with fuzzy search, or type a new name to create a branch. It offers to save unsaved files first, and shows git's own error if the switch fails. **Shift+Delete**, the **× delete** on the selected row, or a right-click deletes a branch (or use **Delete a branch** in the palette). It asks first, and asks again before deleting a branch with commits that aren't merged anywhere. The current branch can't be deleted.
- **Several repositories, as in VS Code:** open a folder of clones (`ce ~/work` with `front/` and `back/` repositories), or a repository with nested ones or submodules, and each repository gets git: tree marks, gutter markers, blame and file history come from the repository the file is in.
  - **Source control** shows a tab per repository with its count of changed files; it opens on the open file's repository, and `n` / `N` (or a click) switch. Staging, committing, push / pull, branches and history act on the repository shown.
  - **Status bar:** the open file's repository and branch (`front main`). With no file from one open it shows `2 repos ● 4` (changed files over all of them); click it, or run **Source control: choose repository** from the palette, for a menu of each repository's branch and changes, and pick one to open it in Source control. A detached HEAD shows its commit (`old 20bc6aa`).
  - **Where it looks:** folders down to `git.scanDepth` levels below the project (default 1; 2 finds `packages/*/`; 0 turns it off). `git.detectSubmodules: false` leaves out folders with a `.git` file (submodules, linked worktrees). AI review (`v`) sends every repository's changes; AI turns undo per repository. Agent worktrees still need the project itself to be a repository.
- **Merge conflicts:** your side is tinted green and the incoming side blue. A bar shows the count and **Accept current / incoming / both** (Alt+1 / Alt+2 / Alt+3 while the cursor is in a conflict), and Alt+F5 goes to the next conflict. When you're done, save and stage the file.

## Markdown and images

- **Markdown preview:**
  - **Ctrl+K V:** a live preview beside the file that follows your typing and the AI's edits.
  - **Alt+Shift+V:** the preview as its own tab; on the preview tab, it goes back to the file.
  - Both are in the editor's right-click menu, and "Open Preview" is in the tree's.
  - It renders GitHub-flavoured Markdown the way GitHub shows a README:
    - headings with rules, bold, italic, strikethrough and inline code, and links
    - nested lists and task checkboxes, quotes, and `> [!NOTE]` alerts
    - highlighted code blocks, tables with column alignment, footnotes
    - the HTML READMEs use: centred `<div align="center">` blocks, `<b>`, `<br>`, `<img>`, `<details>`, and `<table>`s
    - GitHub's emoji shortcodes (`:rocket:` → 🚀)
  - Arrow keys, PgUp/PgDn and Home/End scroll a preview tab, and the mouse wheel scrolls both.
  - Images in the file show in the preview when they are local. Remote images (badges, for example) aren't downloaded, so they show their alt text.
- **Images:** PNG, JPEG, WebP and GIF open as a tab instead of an error, with the format, size and file size above the picture. Animated GIFs play (Space pauses), in image tabs and in the Markdown preview, and stop while hidden. Small images keep their own size, and big ones shrink to fit. They reload when the file changes. Ctrl+L sends the image to the AI as `@path`, and Claude Code can look at it. SVG files open as text.
- **How images are drawn:** sharp pictures in terminals with kitty graphics or sixel (kitty, WezTerm, Ghostty, foot, iTerm2, and Windows Terminal 1.22+), and coloured blocks elsewhere and inside tmux. If the picture is blank or garbled, set `"preview": { "imageProtocol": "blocks" }` (or `"sixel"`, `"kitty"`).

## Code intelligence

The editor talks to language servers for errors, autocomplete, type info and go-to-definition.

**Servers:**
- **TypeScript and JavaScript**, first one found:
  1. The package's own TypeScript 7 (`tsc --lsp`).
  2. `typescript-language-server`, with the package's own TypeScript (or the one installed beside it).
  3. A global TypeScript 7 (`npm i -g typescript`).
- **Vue:** `typescript-language-server` with Vue's TypeScript plugin, for the `<script>` of `.vue` files: `npm i -g typescript-language-server typescript@6 @vue/language-server` (the plugin needs TypeScript 6).
- **Others:** `rust-analyzer`, `gopls`, `pyright-langserver` (or `pylsp`), `zls` and `clangd`, whenever they're on your PATH.
- **Missing server:** the first file of a language with no server says what to install.
- **Monorepos:** each package gets its own server, run in its folder (the nearest `package.json`, `go.mod`, `pyproject.toml` or `Cargo.toml` between the file and the folder you opened). The status bar names them, for example `typescript:backend typescript:ui-admin`.
- **When they run:** a server starts the first time you open a file of its language (or package), and stops a minute after its last file closes.

**Features:**
- **Errors and warnings:** a ● before the line number, red for errors and yellow for warnings. The text is underlined.
  - **Status bar:** shows `✖ 2 ⚠ 1`; click it for the Problems list.
  - **Cursor line:** with the cursor on a line that has a problem, the status bar shows the message.
- **F8:** next problem. **Ctrl+Alt+E:** all problems in open files.
- **Autocomplete:**
  - **When it appears:** suggestions show after `.`, or once you've typed two letters. Ctrl+Space asks for them anytime.
  - **Picking one:** ↑↓ to choose, Enter or Tab to accept, Esc to close.
  - **Turning it off:** set `editor.autocomplete: false`.
- **Ctrl+Alt+I:** type info and docs for the symbol under the cursor, plus any problem on that line.
- **F12 or Ctrl+click:** go to definition, across files (Alt+click also works, for terminals that keep Ctrl+click). Ctrl+Alt+← comes back. **Shift+F12:** all references.
- **F2:** rename the symbol under the cursor in every file. Open files change in place, and Ctrl+Z undoes it. Closed files are saved directly.
- **Shift+Alt+F** (or Ctrl+Alt+L): format the file. Projects with Prettier (in `node_modules`, or a Prettier config and `prettier` on PATH) use Prettier, as VS Code's Prettier extension does. A project with a Prettier config or a `[fmt]` section in `bunfig.toml` but no Prettier installed uses [Bun's formatter](https://bun.com/docs/format), which reads that config and is built into `ce` (nothing to install). Other files use the language server, and Bun's formatter takes the ones it can't format: Markdown, YAML, CSS, JSON, HTML, GraphQL and the like. `editor.formatter` forces one (`"bun"`, `"prettier"` or `"lsp"`), and `editor.formatOnSave: true` formats on Ctrl+S.
- **Parameter hints:** while you type arguments in a call, its signature shows above the cursor, with the current parameter highlighted. Turn this off with `editor.parameterHints: false`.

Use another server, or turn one off, in the config: `{ "lsp": { "python": { "command": ["pylsp"] }, "go": false } }`.

## Coming from VS Code

Most VS Code keys work as you expect: Ctrl+P, Ctrl+Shift+P (or F1), Ctrl+S, Ctrl+F, Ctrl+G, Ctrl+D, Ctrl+/, F2, F12, Shift+F12, Shift+Alt+F, Alt+↑/↓ to move lines, Shift+Alt+↑/↓ to copy them, Alt+←/→ back and forward, Alt+1–9 for tabs, Home/End, and the common Ctrl+K chords (Ctrl+K Ctrl+C, Ctrl+K Ctrl+U, Ctrl+K Ctrl+S, Ctrl+K Z, Ctrl+K S).

Terminals can't send some Ctrl+Shift keys (they arrive as the plain Ctrl key), so those have stand-ins:

| VS Code | Here | Why |
| --- | --- | --- |
| Ctrl+Shift+K (delete line) | Alt+Shift+K | Ctrl+Shift+K arrives as Ctrl+K, which starts a chord |
| Ctrl+Shift+L (select all occurrences) | Ctrl+Alt+A | Ctrl+L sends the file to the AI |
| Ctrl+H (replace) | Ctrl+F twice, or Ctrl+Shift+H | Ctrl+H is Backspace in terminals |
| Ctrl+Shift+F (search files) | Ctrl+Alt+F | Works as Ctrl+Shift+F only in terminals that send it |
| Ctrl+Shift+H (replace in files) | Ctrl+Alt+F, then Ctrl+F | Ctrl+Shift+H arrives as Backspace. Alt+Enter replaces all; Alt+C / Alt+W / Alt+R toggle case, whole word, regex |
| Ctrl+. (quick fix) | Alt+. | Most terminals send Ctrl+. as a plain `.`. Shift+Alt+O organizes imports, as in VS Code |
| Ctrl+Shift+E / Ctrl+Shift+G | Alt+E / Ctrl+Alt+D | Focus the file tree / source control. Ctrl+B shows or hides the sidebar, as in VS Code |
| Ctrl+R (open recent) | Ctrl+Alt+O | Ctrl+R reloads the file from disk |
| Ctrl+Shift+T (reopen tab) | Ctrl+Alt+T | Ctrl+T is "go to symbol in project", as in VS Code |
| Ctrl+Tab | Ctrl+PageDown, Alt+1–9 | Terminals don't send Ctrl+Tab |
| Ctrl+` (terminal) | Alt+` | A terminal tab in the AI pane. Ctrl+` arrives as Ctrl+Space in most terminals |
| Ctrl+Alt+↑/↓ (add cursor) | Ctrl+D | Multi-cursor here is by occurrence. Ctrl+Alt+↑/↓ copy lines |
| Alt+F5 (next change) | Alt+F5 | Same key. Alt+H shows the change |
| Ctrl+Shift+V (Markdown preview) | Alt+Shift+V | Ctrl+Shift+V arrives as Ctrl+V (paste). Ctrl+K V opens it to the side, as in VS Code |

Settings that match VS Code's: `editor.cursorStyle` (`"line"`, the default, `"block"` or `"underline"`; also the AI pane's tabs, unless their program picks a shape), `editor.wordWrap` (Alt+Z toggles it), `editor.formatOnSave`, `editor.autoClosingBrackets`. **Import VS Code settings** in the palette (F1) copies yours into the config (it finds VS Code's settings on Linux, macOS, Windows, and Windows from WSL). Ctrl+F starts with the selection or the word under the cursor, and typing replaces it.

Rebind anything in `~/.config/copane/config.json` under `keys` (command names are in `src/keymap/commands.ts`), including two-key chords: `{ "keys": { "editor": { "ctrl+k ctrl+w": "buffer.close" } } }`.

## macOS

On a Mac, keys work the Mac way (`"keyStyle": "auto"`; `"mac"` or `"pc"` forces one):

- **⌘ works for every Ctrl shortcut**: ⌘S, ⌘P, ⌘⇧P, ⌘F, ⌘Z / ⌘⇧Z, ⌘D, ⌘/, and the chords (⌘K ⌘C, ⌘K S…). ⌘A selects all, ⌘1–9 go to a tab, ⌘⇧[ / ⌘⇧] or ⌘⌥←/→ switch tabs. Ctrl keys keep working too.
- **Text navigation**: ⌥←/→ jumps a word, ⌥⌫ deletes one, ⌘←/→ goes to the line's start (its indent first) and end, ⌘↑/↓ to the file's, ⌘⌫ deletes to the line's start. Add ⇧ to select.
- **Moved for that**: back / forward are ⌃⌥←/→ (or ⌃- / ⌃⇧-, as in VS Code for Mac), and file blame is ⌥⇧B (⌥B is a word back in most Mac terminals).
- **Labels**: the palette, the cheat sheet and notices show ⌘⇧P, not Ctrl+Shift+P.

A terminal only passes ⌘ to programs that ask for it with the kitty keyboard protocol, and only for keys it doesn't use itself. The first start on a Mac says whether yours does. Setup per terminal:

| Terminal | ⌥ as Alt (needed for ⌥ shortcuts like ⌥N) | ⌘ shortcuts |
| --- | --- | --- |
| [Ghostty](https://ghostty.org) | `macos-option-as-alt = true` | Yes. Ghostty keeps ⌘C/⌘V (copy and paste work as usual), ⌘K, ⌘D, ⌘F, ⌘W, ⌘T and ⌘1–9 for itself; free the ones you want with `keybind = super+k=unbind` (one line each) |
| kitty, WezTerm | kitty: `macos_option_as_alt yes`; WezTerm: `send_composed_key_when_left_alt_is_pressed = false` | Yes, for keys not bound in their config |
| iTerm2 | Profiles › Keys › Left Option key: Esc+ | Profiles › Keys: turn on "Apps can change how keys are reported"; ⌘ keys iTerm2's menus use stay with iTerm2 |
| Terminal.app | Profiles › Keyboard › Use Option as Meta key | No: use the Ctrl keys (labels then show ⌃) |

Ghostty and iTerm2 send ⌘←/→ and ⌘⌫ as the shell keys Ctrl+A / Ctrl+E / Ctrl+U, and ⌥←/→ as ESC b / ESC f; copane reads them as the Mac keys they stand for.

## Keys

Press **F1** for the command palette: every command, searchable, with its shortcut. Press **Ctrl+Alt+K** for a grouped cheat sheet.

| Key | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+Q | Quit, with a prompt if there are unsaved changes |
| F1 (also Ctrl+Shift+P, Ctrl+Alt+P) | Command palette |
| Ctrl+P | Go to file (fuzzy, recent files first); `@` symbols in this file, `:` line, `#` project symbols. Works from the AI pane too |
| Ctrl+T / Ctrl+Shift+O | Go to symbol in the project / in this file (Ctrl+P with `#` / `@`) |
| Alt+← / → (or Ctrl+Alt+← / →) | Back / forward through jumps (definition, search results, go to line, opened files) |
| Ctrl+F | Find in the file. Press it again for replace |
| Ctrl+G | Go to line[:column] |
| Ctrl+Alt+F (or Ctrl+Shift+F) | Search in all files: the left pane's SEARCH tab, seeded with the selection or the word under the cursor (ripgrep when installed; a popup in terminals under 100 columns). Results are grouped by file; Enter or a click opens one and keeps you in the list, Esc goes back to the editor. ▸ (or Ctrl+F) adds a replace row with ⇄ All (or Alt+Enter, after a confirm). Aa / ab / .* (or Alt+C / Alt+W / Alt+R) toggle case, whole word, regex. On a hovered result or file, ⇄ replaces just that and × hides it (Replace all then skips it). The files field takes globs (`src/**, !*.test.ts`) |
| Ctrl+Alt+D | Source control: stage, commit, push |
| Alt+H / Alt+F5 / Shift+Alt+F5 | Show the change at the cursor / next / previous change |
| Ctrl+Alt+G / Ctrl+Alt+B | File history / switch branch |
| Alt+B | File blame: who changed each line (GitLens' Toggle File Blame) |
| Ctrl+Space | Autocomplete |
| F12 / Shift+F12 / Ctrl+Alt+I | Go to definition / references / type info under the cursor |
| F2 / Shift+Alt+F | Rename symbol everywhere / format document (also Ctrl+Alt+L) |
| Alt+. (or Ctrl+.) / Shift+Alt+O | Quick fix: code actions at the cursor (add import, fix, refactor) / organize imports |
| F8 / Ctrl+Alt+E | Next problem / all problems |
| Alt+Z | Toggle word wrap (`editor.wordWrap` sets the default) |
| Ctrl+/ | Toggle line comment on the line or selected lines (Ctrl+K Ctrl+C adds, Ctrl+K Ctrl+U removes) |
| Alt+↑ / Alt+↓ | Move the line or selected lines up / down |
| Shift+Alt+↑ / Shift+Alt+↓ | Copy the line or selected lines up / down (also Ctrl+Alt+↑ / ↓) |
| Alt+Shift+K | Delete the line or selected lines |
| Tab / Shift+Tab | Indent / outdent (Tab with no selection inserts spaces, or a tab in tab-indented files). Ctrl+] indents the line |
| Home / End | First character of the line (again: column 0) / end of the line. Ctrl+Home / Ctrl+End: start / end of the file |
| Ctrl+← / → , Ctrl+Backspace / Ctrl+Delete | Move by word, delete a word |
| Ctrl+K Ctrl+X / Ctrl+K S / Ctrl+K Z | Trim trailing whitespace / save all / maximize the editor |
| Ctrl+D / Ctrl+Alt+A | Multi-cursor: add the next occurrence / all occurrences of the word or selection |
| Ctrl+B | Show or hide the sidebar (shown again with the file tree focused) |
| Alt+E | Focus the file tree (from the SEARCH tab: back to FILES) |
| Ctrl+E | Focus the editor |
| Ctrl+J | Focus the AI pane (in the pane, Ctrl+J is the CLI's new line; Ctrl+E goes back) |
| Ctrl+Alt+J | Show or hide the AI pane |
| Ctrl+Alt+M | Maximize the editor, and press again to restore |
| Ctrl+Alt+X | Maximize the AI pane (or **⤢** in its header): it fills the window, even with tabs open. The editor stays hidden until you open a file (from the tree, Ctrl+P, links), which shows it beside the AI pane, or press Ctrl+E (with tabs open); pressing again hides it, and pressing once more restores the layout. Separately, while no file is open there is no editor, only the tree and the AI pane (`editor.startHidden: false` shows the editor's "No file open"); maximizing and restoring the AI pane leaves that alone |
| Ctrl+L | Send the current file, or the selected lines, to the AI prompt |
| Ctrl+K F | Send errors and warnings to the AI ("fix these") |
| Ctrl+K D | Send your git changes to the AI ("review these") |
| Ctrl+Alt+Z | AI turns: review and undo what the AI changed, per prompt |
| Alt+N / Alt+P | Next / previous unreviewed AI change, with what it replaced: **a** accept, **r** undo (from the editor or tree) |
| Ctrl+Alt+V | Review the AI's changes (the next one), from anywhere, including the AI pane |
| Ctrl+Alt+N | New agent tab (another CLI, or one in its own git worktree) |
| Ctrl+Alt+PageDown / PageUp | Next / previous agent tab |
| Ctrl+Alt+W (in the AI pane) | Close the agent tab |
| Ctrl+W / Ctrl+Alt+T | Close tab / reopen the last closed tab (also Ctrl+Shift+T where the terminal sends it) |
| Ctrl+PageUp / Ctrl+PageDown | Previous or next tab |
| Alt+1 … Alt+9 | Go to tab 1–8, Alt+9 the last |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, paste. Without a selection, copy and cut take the whole line |
| Ctrl+A | Select all |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+R | Reload a file that changed on disk, dropping local edits |
| Ctrl+Alt+R | Restart (loads a newly installed version), keeping the folder, open tabs and AI pane tabs (Claude tabs resume their conversations) |
| Ctrl+Alt+O | Open a recent folder (or type one), switching the editor to it |

**Typing:** Enter keeps the line's indent, one level more after `{`, `(` or `[`, and between a pair like `{}` the closer goes to its own line. Brackets and quotes close themselves, typing the closer steps over it, and Backspace between an empty pair deletes both. A bracket or quote typed over a selection wraps it. Turn these off with `editor.autoIndent: false` and `editor.autoClosingBrackets: false`.

**Multi-cursor (Ctrl+D):**
- **Selecting:** the first press selects the word under the cursor, and each press adds the next occurrence. Ctrl+Alt+A takes all of them.
- **Editing:** typing, Backspace and Ctrl+V change every occurrence at once. The status bar shows how many are active.
- **Leaving:** Esc, an arrow key or a click ends it.
- **Matching:** starting from a word matches whole words only. Starting from a selection matches the exact text.

**Find bar:**
- Enter or ↓ goes to the next match, ↑ to the previous, and Esc closes the bar.
- Search ignores case unless your text has a capital letter.
- In the replace field, Enter replaces one match and Alt+Enter replaces all. Each replace is a single undo step.

While the AI pane has focus, every key goes to the CLI except Ctrl+Q, Ctrl+E (back to the editor), Ctrl+P, F1, Alt+` (new terminal) and the Ctrl+Alt keys: J, X, D, R, Z, W, V, N and PgUp/PgDn. Esc, Ctrl+C, Shift+Tab, Ctrl+J (Claude's new line, since terminals send Shift+Enter as Enter) and Ctrl+B (run in background; in a shell, cursor back) therefore work as usual. To take a key back, bind it under `keys.ai`, e.g. `"keys": { "ai": { "ctrl+j": "focus.editor" } }`.

Dragged pane widths are remembered in `~/.local/state/copane/layout.json`.

## File tree

The mouse works as in VS Code's explorer:
- A click on a file opens it and keeps focus in the tree, so the keys below still work. A double-click moves focus to the editor.
- Drag a file or folder onto a folder (or onto a file in it, or onto empty space for the project root) to move it. You confirm the move, and open tabs follow.
- The buttons at the right of the FILES tab create a file or folder next to the selection (+, +/), refresh the tree (↻) and collapse all folders (⊟). With Nerd Font icons they show as VS Code's icons.

With the tree focused (Alt+E, or a click), or from the right-click menu on a row:

| Key | Action |
| --- | --- |
| a | New file next to the selection (`lib/x.ts` creates folders too) |
| Shift+A | New folder |
| r / F2 | Rename (the cursor starts before the extension) |
| Delete | Delete permanently, after a confirmation |
| Enter / Space | Open the file and go to the editor / open it and stay in the tree |
| Shift+Alt+R | Reveal in File Explorer (WSL), Reveal in Finder (macOS), or Open Containing Folder (Linux) |

The menu also has the reveal item, Copy Path, Copy Relative Path, Send to AI (types `@path` into the AI prompt), and Open Preview for Markdown files. Right-click empty space to create at the project root, or to reveal the project folder. In the editor, Shift+Alt+R reveals the open file. Open tabs follow renames; deleting closes their tabs unless they have unsaved changes.

In a git repository the tree shows status: **M** modified (yellow), **U** untracked, **A** added, **R** renamed (green), **!** conflict (red). A folder shows • in the colour of the most important change inside it. Marks update when files change and when you stage or commit.

The AI's work shows there too, in violet: **✎** on files the AI is editing in the current turn, **✦** on files with changes you haven't reviewed, and a violet • on the folders above them. Clicking a ✦ file opens it at its first AI change. The right-click menu adds **Review AI Changes** and **Accept AI Changes**, or **Accept AI Changes in Folder** on a folder.

Files and folders matched by `.gitignore` (`dist/`, `.env`, ...) show faded in the tree, as in VS Code; `{ "tree": { "showIgnored": false } }` hides them. `.git` and `node_modules` are never listed, and Ctrl+P and project search skip ignored files either way.

## Icons

The tree shows file-type icons. Set the style in the config: `{ "tree": { "icons": "nerd" } }`.

| Style | Looks like | Needs |
| --- | --- | --- |
| `nerd` | VS Code-style icons for TS, React, JSON, git, npm and more | a Nerd Font in your terminal |
| `simple` (default) | coloured symbols: ◆ TS, { JSON, ¶ Markdown, ± git | any font |
| `none` | no icons | |

Both install scripts set this up by running `copane --install-font`, which you can also run yourself. It installs the bundled **CaskaydiaMono Nerd Font**, which is Cascadia Mono plus icons, from `assets/fonts/`. It works offline. It is the non-Mono variant, so icons are drawn full size instead of squeezed into one letter's width.

- **WSL with Windows Terminal:**
  - **Font:** installed for your Windows user, with no admin needed.
  - **Windows Terminal:** the font becomes its default. This only happens when no font is chosen there yet, or when an earlier install set "CaskaydiaMono Nerd Font Mono", which is switched to the new face. `settings.json` is backed up next to itself first.
  - **Editor:** `tree.icons` is set to `"nerd"`, unless you already set it.
  - Close every Windows Terminal window and open it again, once, to load the font. A new tab or a `ce` restart is not enough, because Windows Terminal reads fonts only when it starts.
- **macOS and Linux:** the font is copied to `~/Library/Fonts` or `~/.local/share/fonts`. Choose "CaskaydiaMono Nerd Font" in your terminal, then set `tree.icons` to `"nerd"`.
- **Skip it:** set `FONT=0` when installing. Once the font is set up, later installs skip this step; `FONT=force copane --install-font` redoes it.
- **Undo:** set `tree.icons` to `"simple"`, or restore the `settings.json.bak-…` file in Windows Terminal's settings folder.

If icons show as boxes, your terminal isn't using a Nerd Font yet. On Windows, fully close and reopen Windows Terminal.

## Mouse

- **Editor:** click to place the cursor, drag to select, double-click selects a word. The wheel scrolls without moving the cursor, and Shift+wheel scrolls sideways.
- **Line numbers:** click a number to select that line, drag to select several.
- **Ctrl+click** (or Alt+click) a name to go to its definition.
- **Right-click:** a menu with Go to definition, Find all references, Cut, Copy, Paste, Select all and Send to AI. In the AI pane there is no menu: right-click copies the selection, or pastes when nothing is selected.
- **Panes:** clicking a pane focuses it. Drag the border between panes to resize them, and double-click it to reset that pane's width.
- **Tree and picker:** the wheel scrolls, rows highlight on hover, and a click opens the file or toggles the folder. Right-click a tree row for file actions. In a narrow tree, long names are clipped at the edge: Shift+wheel (or a sideways swipe) scrolls the tree sideways.
- **Tabs:** click to switch, click × or middle-click to close, wheel over the tab bar to cycle.
- **Status bar:** the key hints are buttons, and clicking the AI status switches focus.
- **Dialogs:** buttons are clickable, and clicking outside closes them. A dialog opened from another one (Source control's Discard question, Branches, History) goes back to it on Esc or a click outside.
- **AI pane:** select text with the mouse to copy it. Ctrl+C stays with the CLI.

While the editor captures the mouse, most terminals use Shift+drag for their own text selection.

Copying goes to the system clipboard through the terminal (OSC 52) and through `powershell.exe` on WSL, `pbcopy` on macOS, or `wl-copy`, `xclip` or `xsel` on Linux. Pasting with Ctrl+V reads the clipboard through the same tools. Your terminal's own paste shortcut also works. Inside tmux, enable `set -g mouse on` and `set -g set-clipboard on`.

## Config

Optional file at `~/.config/copane/config.json`. **Open settings (JSON)** in the palette (F1) opens it and creates it if needed. Comments and trailing commas are allowed, as in VS Code.

```json
{
  "ai": { "command": "claude", "args": [], "startHidden": false, "notify": "bell", "agents": [{ "name": "codex", "command": "codex" }], "services": [] },
  "editor": { "highlightMaxBytes": 1000000, "copyOnSelect": false, "saveBeforeAi": true, "autocomplete": true, "cursorStyle": "line", "wordWrap": false, "startHidden": true, "highlightCursor": true, "indentGuides": true, "autoIndent": true, "autoClosingBrackets": true, "formatter": "auto", "formatOnSave": false, "smoothScrolling": true },
  "lsp": { "python": { "command": ["pylsp"] } },
  "tree": { "icons": "simple", "showIgnored": true },
  "startup": { "welcome": true },
  "git": { "blame": true, "inlineBlame": true, "aiCommitMessage": true, "scanDepth": 1, "detectSubmodules": true },
  "statusBar": { "resources": true },
  "preview": { "imageProtocol": "auto" },
  "update": "auto",
  "keyStyle": "auto",
  "keys": { "global": { "ctrl+o": "file.picker", "ctrl+l": null } }
}
```

`ai.command` can be any terminal program, for example `codex`, `opencode`, `gemini` or your shell. Key overrides map a key to a command name from `src/keymap/commands.ts`, and `null` removes a binding. The command palette (F1) shows every command.

## Syntax highlighting

Highlighting uses Tree-sitter through OpenTUI, for JavaScript, TypeScript, JSX/TSX, Python, Rust, Go, C, C++, Bash, HTML, CSS, SCSS, Vue, Svelte, Astro, JSON (and JSONC), YAML, TOML, SQL, Dockerfile, nginx config, Markdown and Zig. Code inside markup is coloured as its own language: `<script>` and `<style>` in HTML get JavaScript and CSS; in Vue, Svelte and Astro, scripts and template expressions (`{ }`, `{{ }}`, `:prop`, `@click`, `v-if`) get TypeScript and `<style>` gets SCSS. `.env` files read as shell. nginx config is recognised as `nginx.conf`, `*.nginx`, and `.conf` or extensionless files in an `nginx` folder (`sites-available/default`). The same grammars colour fenced code blocks in the Markdown preview. The grammars are embedded in the binary, so nothing needs installing. To add a language, see `src/editor/grammars.ts`.

## Development

```sh
bun test           # unit and render tests
bun run typecheck
```

`scripts/smoke.md` is the manual checklist for things the tests cannot cover.

## Contributing

If copane saves you a context switch, a ⭐ on GitHub helps other people find it.

**Found a bug?** Press F1 and run **Report a problem**: your AI in the side pane gets copane's version, your platform and the end of the error log (with your paths shortened), asks what happened, checks for an existing issue, and shows you the report. It only posts it (with `gh`) after you say yes, or gives you a ready-made link to open.

Issues and pull requests are welcome, including ones written with an AI coding agent. Look for
[`good first issue`](https://github.com/sevheng/copane/labels/good%20first%20issue) and
[`agent-friendly`](https://github.com/sevheng/copane/labels/agent-friendly) issues; each says where to start and what "done" means.
[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and tests, [AGENTS.md](AGENTS.md) the architecture and rules (your agent reads it
automatically), and [CHANGELOG.md](CHANGELOG.md) what's new.

## License

[MIT](LICENSE). The bundled CaskaydiaMono Nerd Font is under the SIL Open Font License 1.1
(`assets/fonts/LICENSE-OFL.txt`).
