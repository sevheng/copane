# Changelog

All notable changes to copane are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **A state folder copane can't write is reported.** When `~/.local/state` (or `$XDG_STATE_HOME`) isn't writable, for example a folder a `sudo` run left owned by root, recent folders, pane widths and backups of unsaved work were silently not kept. A notice at startup now says so, with the `chown` command that fixes it.

## [0.9.11] - 2026-10-24

### Added
- **Mac keys** (`keyStyle`, on by default on macOS): ⌘ works for every Ctrl shortcut (⌘S, ⌘P, ⌘⇧P, ⌘K chords…) in terminals that send it (Ghostty, kitty, WezTerm, iTerm2), ⌘A selects all, ⌘1–9 and ⌘⇧[ / ⌘⇧] switch tabs. ⌥←/→ jumps a word, ⌘←/→ goes to the line's start and end, ⌘⌫ deletes to the line's start, also as Ghostty and iTerm2 send them (Ctrl+A / Ctrl+E / Ctrl+U, ESC b / ESC f). The palette, cheat sheet, menus and notices show ⌘⇧P-style keys (⌃ where the terminal can't send ⌘). The first start on a Mac says how to set up the terminal; the README has a macOS section.
- `cmd+…` in `keys` config bindings (also `command+` / `super+`).
- **Format with Bun's formatter** (`bun fmt`, built into `ce`): Shift+Alt+F uses it in projects with a Prettier config or bunfig.toml `[fmt]` but no Prettier installed, and for files the language server can't format (Markdown, YAML, CSS, JSON…), which used to say "No language server". Projects with Prettier keep Prettier. `"editor": { "formatter": "bun" }` always uses it.

### Changed
- Built with and needs Bun 1.4.4 (for its formatter).
- On a Mac, back / forward move from ⌥←/→ to ⌃⌥←/→ (also ⌃- / ⌃⇧-), and file blame from ⌥B to ⌥⇧B, since Mac terminals use those keys for word movement.

## [0.9.10] - 2026-10-17

### Added
- A folder of several repositories with no file from one open: the status bar shows `2 repos ● 4` instead of nothing. Clicking it (or **Source control: choose repository** in the palette) lists each repository with its branch and changed files; picking one opens it in Source control.

### Changed
- A detached HEAD shows its short commit in the status bar and Source control, not the word "detached".

### Fixed
- A project folder that is not a repository but holds one (`ce .` in a folder with one clone inside): the status bar shows that repository's branch before any of its files is open.

## [0.9.9] - 2026-10-17

### Changed
- In the AI pane, Ctrl+J and Ctrl+B go to the CLI: Ctrl+J is Claude's new line (terminals send Shift+Enter as plain Enter, so there was no way to type one), and Ctrl+B is its "run in background" (in a shell tab, cursor back). Ctrl+E goes back to the editor; Ctrl+J from the editor still focuses the pane. `keys.ai` brings the old keys back.

### Added
- Alt+` opens a terminal tab from the AI pane too, not only from the editor.
- A restart (Ctrl+Alt+R, or after an update) brings back the AI pane's tabs. Each Claude tab gets its own conversation id (`--session-id`) and resumes it (`--resume`), so two Claude tabs in one folder each get their own conversation back. Dev servers run their command again, and terminals open a fresh shell. Tabs whose worktree was removed stay closed.
- Enter after you exit Claude in a tab brings it back in the same conversation (`/clear` for a fresh one).

### Fixed
- A dialog opened from another one goes back to it on Escape, a click outside or Cancel, one level at a time: Source control's Discard question, the search popup's Replace all question, Compare first from the "changed on disk" question, and Source control opened from Review & merge. Before, they closed everything.
- Dialogs opened from Source control (Branches, File history, History, the Discard question) show above the panel, which stays on screen under them, instead of replacing it.
- Stage or Discard from Source control's right-click menu keeps the panel open throughout, instead of closing and reopening it. Its commit box no longer takes a paste while the menu is open.
- A hover, references list or quick-fix menu that arrives after you opened another dialog no longer replaces it, and a file opened from a list no longer closes a dialog opened while it loaded.
- Claude's "trust this folder?" question, asked while a dialog was open, now brings you to the AI pane once the dialog closes (it was missed).
- Ctrl+Q quits from under any dialog (still asking about unsaved files). In a terminal too small to draw the dialog, Escape closes it.

## [0.9.8] - 2026-10-16

### Changed
- Less memory per window. The syntax-colouring worker, whose memory only grows (about 40 MB after a typical file, 180 MB after a 300 KB one, 350 MB after an 800 KB one, kept until the window closed), now stops after a minute without highlighting or soon after you switch to another app, and starts again on the next edit. An idle window that had a big file open goes from ~230 MB to ~85 MB of its own memory. The binary also runs with Bun's `--smol` (5–10 MB less, typing speed unchanged), and freed memory is handed back when the window goes to the background.
- The status bar's memory figure counts what each process uses on its own (Linux): the program's code, shared between windows, no longer makes each window look bigger.

### Added
- `CE_MEM=/path/to/log` logs a window's memory every 10 s, and `bun run test/perf/memory.bench.tsx` reports what each part of a window costs.

## [0.9.7] - 2026-10-16

### Added
- File tree toolbar: New File, New Folder, Refresh and Collapse All buttons at the right of the FILES tab (in the EXPLORER header in the standalone tree).
- Drag a file or folder in the tree onto a folder to move it (after a confirmation); open tabs follow.
- Alt+E focuses the file tree (VS Code's Ctrl+Shift+E, which terminals send as Ctrl+E).
- Welcome page: `ce` with no folder lists recently opened folders (with their git branch and when you last opened them) to pick with a click or the keys, opens the current folder, or browses for one (type to filter, click to go in, **open** to open). Ctrl+Alt+O (Open recent folder) switches folders from inside the editor. `startup.welcome: false` keeps opening the current folder.
- The home folder is handled as what it is: started in `~`, the welcome page browses it instead of opening it, and opening `~` or `/` asks first. With `~` open anyway, its hidden entries (`.claude`, `.cache`, `.nvm`, ...) are treated as ignored, so tools writing there (the AI's session logs) aren't taken for changes and `.nvm`-style clones aren't listed as your repositories.
- Several git repositories in one project, as in VS Code: a folder of clones, nested repositories and submodules each get tree marks, gutter markers, blame and history from their own repository. Source control has a tab per repository (`n` / `N` switch), and the status bar shows the open file's repository and branch. `git.scanDepth` (default 1) and `git.detectSubmodules` (default true) set where it looks.

### Changed
- Starting without a file, focus is on the AI pane, so its first question (Claude's "do you trust this folder?") gets your keys; it used to look stuck behind the tree.
- `ce` without a folder shows the welcome page instead of opening the current folder; use `ce .` for that. Restarts (updates, Ctrl+Alt+R) keep the folder.
- A click on a file in the tree opens it and keeps focus in the tree, as in VS Code; a double-click (or Enter) goes to the editor. Space opens a file and stays in the tree.
- Ctrl+B shows or hides the sidebar, as in VS Code, instead of focusing the tree first.
- The status bar shows the project's own repository when no file is open, never a nested one.
- The sidebar no longer shows the project folder name, neither in its tab row nor in the EXPLORER header (the terminal tab is still titled with it).

## [0.9.6] - 2026-10-14

### Added
- The files pane shows git-ignored files and folders (`dist/`, `.env`, ...) faded, as VS Code does, instead of hiding them. `tree.showIgnored: false` hides them again.

## [0.9.5] - 2026-10-14

### Changed
- Opening a file while the editor is hidden (the default start, or Ctrl+Alt+X) now shows the editor beside the AI pane, instead of keeping it hidden until Ctrl+E.
- `editor.startHidden` is no longer "maximize AI" in disguise: the editor is hidden only while no file is open, the AI pane starts with ⤢ (not ⤡), and maximizing and restoring the AI pane no longer changes whether the editor shows.

## [0.9.4] - 2026-10-14

### Fixed
- A language server's slow answer about an older version of a file no longer brings back problems you already fixed (on a busy machine, the status bar could stay at ✖ 1 after a quick fix).

## [0.9.3] - 2026-10-14

### Added
- Monorepos: each package gets its own language server, run in its folder with its own TypeScript. The status bar names them (`typescript:backend`).
- TypeScript without a project install: `typescript-language-server` falls back to the TypeScript installed beside it, then to a global TypeScript 7 (`tsc --lsp`).
- Vue: syntax colours (TypeScript in `<script>`, `{{ }}` and directives, SCSS in `<style>`), and code intelligence through `typescript-language-server` with Vue's TypeScript plugin.
- Syntax colours for SQL and Dockerfiles; `.env` files read as shell.
- Syntax colours for SCSS, Svelte, Astro and nginx config. HTML now colours the JavaScript and CSS in `<script>` and `<style>`, and Svelte and Astro colour their scripts, styles and template expressions as TypeScript and SCSS.
- A language with no server installed says what to install, once.
- Terminals in the AI pane: **New terminal** (**+**, or Alt+`) opens your shell in a tab beside the agents, and **▶ Run …** opens one running a package's dev server (each package's `dev` script, or `docker compose up`, detected; or your own with `ai.services`).
- Terminal errors: a tab whose output shows an error (compile error, stack trace, crash) turns `✗`. **✗ Fix with AI** in the header, or **Ctrl+K E**, sends it with the file and line it points to into the agent's prompt. Text for the AI never goes to a terminal tab.
- The AI pane needs no right-click menu: **+** opens agents, terminals and dev servers, **↻** restarts a dev server, a worktree agent's `· N` opens Review & merge, and right-click copies the selection or pastes (as VS Code's terminal on Windows).
- Ctrl+click (or Alt+click) a `file:line` or a URL in an AI pane tab to open it.
- **+ › Resume claude ⎇ copane/…** reopens an agent worktree whose tab closed (or from before a restart), with its change count and Review & merge; Claude continues its last conversation.
- **Maximize AI pane** (Ctrl+Alt+X, or **⤢** in the AI pane header): the AI pane fills the window, even with tabs open. Opening a file doesn't bring the editor back: Ctrl+E (with tabs open) shows it beside the AI pane, pressing again (or closing the last tab) hides it, and pressing once more restores the tree and editor.
- The text cursor is a thin blinking line, as in VS Code, in the editor, every input and the AI pane's tabs (a program there can still pick its own shape, as vim does). `editor.cursorStyle` (`"line"`, `"block"`, `"underline"`) changes it.
- `ce` starts with only the file tree and the AI pane; the editor shows when you ask for it (Ctrl+E, Ctrl+Alt+X or ⤡). `editor.startHidden: false` starts with the editor as before.
- Resource usage in the status bar (`▤ 1.2G 15%`): memory and CPU of copane and everything it started. Click it to see what each language server, agent and terminal uses. Turn it off with **Toggle resource usage** (F1) or `statusBar.resources: false`.

### Changed
- The AI pane header no longer repeats "✦ N to review" (the status bar has it), and worktree tabs drop the `copane/` prefix (`CLAUDE ⎇ CLAUDE-1`).
- File tree: long names are clipped at the pane's edge instead of cut with `...` in the middle. Shift+wheel (or a sideways swipe) scrolls the tree sideways to read them, and moving the selection onto one scrolls it into view. Narrow trees (under 30 columns) indent one column per level.

### Fixed
- Review & merge: when your own uncommitted edits touch files the agent also changed, merging said only "Your local changes … would be overwritten". It now names the files and offers **Commit mine & merge (c)** or **Source control (s)**.
- nginx config: `upstream backend {` (a block with arguments), addresses such as `127.0.0.1:8080`, and one-line blocks such as `events { worker_connections 1024; }` broke the colours of everything after them. A `.conf` file outside an `nginx` folder (`deploy/conf/conf.d/app.conf`) is recognised as nginx by its content (`server {`, `upstream app {`, …), and files in `sites-available` / `sites-enabled` by their folder.

## [0.9.2] - 2026-10-13

### Added
- GitLens-style blame: the cursor line's author, age and summary after its end (`git.inlineBlame`), and **Alt+B** for a file blame column beside the editor (click a block for its commit). File history rows show each commit's author and age.
- Commit history of the whole project: a **History (g)** button in Source control and **Commit history** in the palette. Esc from it returns to the panel.

## [0.9.1] - 2026-10-13

### Fixed
- Source control: right-clicking a file no longer closes the panel. The menu opens over it, and Esc or a click outside goes back to the panel.
- Source control: Branches (`b`) and a file's history opened from the panel go back to it on Esc, and after switching branch.

## [0.9.0] - 2026-10-13

### Changed
- OpenTUI 0.6 (from 0.5.17): its native side now owns the whole render tree, lays out and draws a frame in one step, and reads text at its exact size. Also upgraded: zod 4.6.7, diff 9, marked 18.

### Added
- The project's folder name shows in the sidebar's tab row and as the terminal tab's title.
- Source control:
  - stage, unstage or discard a single change from the diff (→, then ↑↓ and Space / `r`)
  - each file shows `+N −M` and a `✦` for unreviewed AI changes, with its name first and its folder dimmed
  - `A` unstages everything, `R` discards all unstaged changes, and section headings have buttons for both
  - right-click a file for a menu
  - the commit message takes several lines (Ctrl+J) and shows the summary's length
  - a clean tree shows what's left to push and the last commit
  - a push, pull or commit keeps going when you close the panel: the status bar shows it next to the branch (`⎇ main ⠋ Pushing… 45%`), and its result comes as a notice

### Fixed
- Push, pull and commit can no longer hang the editor or draw over it: git runs without the terminal, so an ssh or gpg passphrase prompt or a hook fails with a message instead of waiting, and a timeout now ends git together with the ssh or hook it started. Commit and merge get a timeout too.
- Staging one hunk in a repo with `core.autocrlf` or `.gitattributes` line endings (or LFS) staged the whole file as changed; it now goes through git's filters like `git add`.
- Staging files quickly in Source control could fail with "index.lock exists": git writes now run one at a time.
- Source control and the tree could show the old status for a moment right after stage, commit or revert.
- Source control: after staging, the selection jumped to an unrelated file; it now stays in the section, on the next file. With many files the selected one could be below the bottom of the list. A multi-line AI commit message no longer gets squashed into one line. Errors stay until the next key, and other messages clear after a few seconds.
- Faster git status in repos with thousands of untracked files (parsed once instead of twice).
- Blame no longer starts a new git process on every cursor move after an edit while the last one is still running, and gives up after 15 s.
- Opening a huge or binary new file, or a commit with a huge diff, in Source control or file history no longer freezes the editor: big diffs are cut (at a change boundary) and binary files are named, not shown.
- Git state changed outside the editor now shows up: a fetch, a push from the terminal or a `reset --soft` updates ahead/behind, the tree marks and blame (only the index and HEAD were watched).
- `git init` (or a clone) in a folder that's already open is picked up when you come back to the window or save a file. If the repo is deleted, its marks go away.
- An agent in its own worktree, started with `ce` opened in a subfolder of a repo: the worktree went inside the repo (and showed up as untracked files there); it now goes beside the repo, and the agent starts in the same subfolder.
- Jumping far in a big file (Ctrl+End, go to definition, Ctrl+G) paused for about 200 ms while syntax colours were redrawn: the screen is now coloured first and the lines around it follow over the next frames. Fewer highlights are sent too: a range captured twice is drawn once, and other uses of the word under the cursor are marked near the screen only (a common word on every line cost tens of milliseconds per cursor move).
- Other uses of the word under the cursor, find matches, the matching bracket and multi-cursor occurrences lost their syntax colour (they showed as plain text on the marker background); they now keep it.
- Push while HEAD is detached says to switch to a branch, instead of trying to publish a branch named "detached".

## [0.8.0] - 2026-10-11

### Added
- Report a problem (F1): the AI in the side pane gets copane's version, platform, terminal and the end of the error log (paths shortened), asks what happened, searches existing issues, and shows the drafted GitHub issue; it posts it with `gh` only after you say yes, or gives you a pre-filled link. Internal-error notices point to it.
- Automatic updates, like Claude Code's: once a day the installed binary checks GitHub and installs a new release in the background; the status bar then offers a restart, and the next start runs it anyway. `"update": "notify"` only says a release is out (a click in the status bar installs it), `"off"` never checks. If installing fails (no permission to replace the binary), it falls back to notifying.

## [0.7.0] - 2026-10-11

### Added
- Review & merge a worktree agent's work: right-click › Review & merge this agent (also in the palette, and offered when closing its tab) lists every file it changed since its branch split off, committed or not, with diffs. **m** commits its leftover edits and merges the branch into yours (conflicts get the usual conflict bar), then offers to remove the worktree, branch and tab; **d** discards it all. A worktree agent's tab shows how many files it changed.

### Changed
- Lighter all-day sessions: an agent CLI that exits on its own no longer leaks its terminal; closed agent tabs stop for good; AI turns keep a hash of each file's "after" text and skip files over 1 MB; output from streaming agents is scanned once per pause instead of per chunk (about 10% less CPU while a new agent tab streams); blame no longer re-runs on every git status change; the reload flash keeps one timer; hidden tabs skip AI-marker updates until shown; language servers re-check other open files at most every 10 s, are killed if they ignore "exit", and are restarted (up to 3 times in 5 minutes) when they crash, with their stale problems cleared; a stuck `git status` or Prettier is stopped after a while; deleted folders leave nothing cached; folder change events no longer throw away the Ctrl+P file list.
- Committing accepts: once a file's content is what HEAD has (you committed it, the AI did, or it was checked out), its AI review marks clear on their own, so they never pile up. Untracked files stay marked until committed.

### Fixed
- The Markdown preview hung (using more and more memory) on an HTML `<img>` that isn't a local file, such as a README's centred logo or badge from a URL. A `%` in an image path (`50%.png`) crashed the app.
- An internal error no longer closes the editor: it shows as a notice, unsaved changes are backed up and come back on the next start (Ctrl+Z drops them), and details go to `~/.local/state/copane/errors.log`. A rendering error offers Ctrl+R to draw the editor again with every file as it was.
- Opening a binary or unreadable file from Source control, history, AI turns, search results or Ctrl+click showed nothing and could close the app; it's now a notice. The same for failing actions in menus and dialogs.
- Saving no longer overwrites a change on disk the editor didn't know about (the file watcher can miss changes on WSL drives): Ctrl+S asks to overwrite or compare, and "Save all" lists what needs a decision. Keys typed during a save keep the file marked unsaved.
- Files that aren't UTF-8 are no longer opened (saving used to corrupt their accented characters); a UTF-8 byte-order mark is kept; files with control characters (form feeds…) show a warning, and saving asks first. Project-wide replace skips files that aren't UTF-8.
- Selecting more than 1 MB (Ctrl+A in a big file) then typing a bracket or cutting dropped everything past the first megabyte.
- Formatting, renames and quick fixes are no longer applied to text that changed while the language server worked (they could garble it).
- AI turn undo keeps CRLF line endings in CRLF checkouts, never deletes a staged file in a repo without commits, and waits until the turn has finished.
- "Use disk" on a conflicted file that was deleted meanwhile keeps your version instead of closing the app. Merging a worktree agent stops its CLI first, so nothing it writes afterwards is lost.
- A new agent "in a git worktree" failed with "branch already exists" after an earlier one's worktree was removed (its branch is kept): it now skips to the next free number.

## [0.6.0] - 2026-10-11

### Added
- Review the AI's edits in the editor: lines it changed get a violet ┃ until reviewed, with a bar above the file and a count in the status bar. Alt+N jumps to the next change and shows what it replaced; **a** accepts it and moves on, **r** undoes it (one undo step), and past the last change Alt+N opens the next file. Accept file, Undo file and Accept all are on the bar and in the palette. Ctrl+Alt+V starts the review from anywhere, including the AI pane, whose header shows "✦ 2 to review" once the AI is done (and the "finished" notice says how many files). What's left to review is remembered across restarts.
- The file tree shows the AI's work: ✎ on files it is editing in the current turn, ✦ on files with unreviewed changes, and a violet dot on their folders. Clicking a ✦ file opens it at its first AI change; the right-click menu can review or accept a file's AI changes, or accept a whole folder's.

## [0.5.0] - 2026-10-11

### Added
- Smooth scrolling: the wheel and PageUp/PageDown glide (fast first, easing out) in the editor and the Markdown preview; consecutive wheel steps add up, and a key stops the motion. `editor.smoothScrolling: false` turns it off.
- Delete a branch: Shift+Delete, the × on the selected row or a right-click in the branch picker (Ctrl+Alt+B), or "Delete a branch" in the palette. Asks first, and again before deleting unmerged work; the current branch is protected.
- Several agents side by side (#18): Ctrl+Alt+N opens another CLI in an AI pane tab (`ai.agents` lists extra ones), optionally in its own git worktree on a new branch. Tabs keep running when hidden and show working / done / needs you; Ctrl+Alt+PageDown/PageUp switch, and "send to AI" goes to the visible tab. Close a tab with its ×, a middle-click or Ctrl+Alt+W; closing a worktree tab offers to remove the worktree (the branch stays).
- AI turns (Ctrl+Alt+Z, #15): every prompt that changes files becomes a turn listing the files, +/− counts and each change since before the turn. Undo the whole turn, one file or one change; files the AI created are removed. Exact even with your own uncommitted edits (a `git stash create` snapshot at the start of each turn), and works with any AI CLI.
- Markdown preview: GitHub's emoji shortcodes (`:rocket:` → 🚀, not in code) and HTML tables, rendered like Markdown tables with their alignment (#14).
- Syntax highlighting for Python, Rust, Go, C, C++, Bash, HTML, CSS, JSON/JSONC, YAML and TOML (#4, #5, #6), in the editor and in Markdown code blocks. The official Tree-sitter grammars are embedded in the binary.
- Send problems or changes to the AI in one key (#17): Ctrl+K F types the errors and warnings (`@file#L12 error: …`) with "fix these"; Ctrl+K D types your git diff with "review these". Also `f` in the Problems list, `v` in Source control, and "Ask AI to fix" in the quick-fix menu (Alt+.).

### Changed
- Less work per key, cursor move and AI output: cursor moves no longer re-render the whole UI (only the status bar and breadcrumbs follow them), tabs and the Markdown preview re-render only when their own content changes (with parsing and image sizes cached), and streaming AI output updates the pane once per stretch instead of per chunk. Polling and GIFs pause while the terminal window is in the background, and agent tabs stop ticking when idle. `CE_PERF` also logs React commits per second in `bun run dev`.
- Faster typing in big files: a key no longer reads and hashes the whole file (the dirty check compares sizes first), the syntax-colour pass after a pause blocks half as long, git change markers diff only the edited region (so files over 20,000 lines get them too), autocomplete sends the file to the language server once instead of twice, and breadcrumbs stop re-asking for symbols after every pause.

## [0.4.0] - 2026-10-11

### Added
- Alerts when the AI finishes or waits for your answer while you're not looking: a notice, the terminal bell, and ✓ done / ⚠ needs you in the AI header and status bar. `ai.notify: "desktop"` adds a system notification (Windows toast on WSL, macOS Notification Center, notify-send); `"off"` disables them.
- Double-click a pane divider to reset that pane to its default width.

### Fixed
- Commits could still fail on "index.lock" while the source control panel showed a diff: every git read copane runs now skips optional locks.
- Large dialogs (source control, history, help) fade the screen behind them, so their margins no longer show stray letters and icons from the panes (#13).
- Staging and committing no longer fail at random with "index.lock: File exists": the background git status no longer takes git's index lock.

## [0.3.0] - 2026-10-11

### Added
- Markdown preview: live beside the file (Ctrl+K V) or as a tab (Alt+Shift+V). It renders GitHub-flavoured Markdown like GitHub does: headings, strikethrough, task lists, alerts, aligned tables, footnotes, highlighted code, local images, and README HTML (centred blocks, `<b>`, `<br>`, `<img>`, `<details>`).
- Images (PNG, JPEG, WebP, GIF) open as a tab showing the picture, drawn with kitty graphics or sixel when the terminal supports them and coloured blocks otherwise. `preview.imageProtocol` overrides the choice. Animated GIFs play, in image tabs (Space pauses) and in the Markdown preview.
- Reveal in File Explorer (WSL), Reveal in Finder (macOS) or Open Containing Folder (Linux): in the file tree's right-click menu, and on Shift+Alt+R as in VS Code.

### Fixed
- After a chord like Ctrl+K Z, the "waiting for the second key" message goes away at once.

## [0.2.0] - 2026-10-11

### Added
- `copane --upgrade` installs the latest release in place; open editors offer a restart.
- `copane --install-font` installs the bundled Nerd Font for file-tree icons. The font is embedded in the binary, so release installs get it too, and `install.sh` runs it (`FONT=0` skips).
- Contributing guide, issue and pull request templates, security policy and code of conduct.
- `scripts/demo/demo.tape` records the README demo with vhs.

### Fixed
- Git marks, staging and blame work when the project path goes through a symlink (for example macOS's `/var`).

## [0.1.0] - 2026-10-11

First public release.

- Terminal editor with Claude Code (or any AI CLI) in a side pane: send selections with Ctrl+L, live reload of AI edits, diff review, and merging when you both edit a file.
- Language servers, autocomplete, go to definition, rename, multi-cursor, Tree-sitter highlighting, and project search and replace.
- Git: hunk staging, commits with AI-written messages, push and pull, blame, file history, branches and merge conflicts.
- VS Code keys and settings import.
- Release binaries for Linux and macOS (x64 and arm64), and a one-line installer.

[Unreleased]: https://github.com/sevheng/copane/compare/v0.9.11...HEAD
[0.9.11]: https://github.com/sevheng/copane/compare/v0.9.10...v0.9.11
[0.9.10]: https://github.com/sevheng/copane/compare/v0.9.9...v0.9.10
[0.9.9]: https://github.com/sevheng/copane/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/sevheng/copane/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/sevheng/copane/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/sevheng/copane/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/sevheng/copane/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/sevheng/copane/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/sevheng/copane/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/sevheng/copane/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/sevheng/copane/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/sevheng/copane/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/sevheng/copane/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/sevheng/copane/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sevheng/copane/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/sevheng/copane/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sevheng/copane/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sevheng/copane/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sevheng/copane/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sevheng/copane/releases/tag/v0.1.0
