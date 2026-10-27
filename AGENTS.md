# copane: notes for AI coding agents (and humans)

Terminal code editor (`ce`) with an AI CLI in a side pane. TypeScript on Bun, UI with OpenTUI (React).
This file is the project's rules for any coding agent (Claude Code reads it through `CLAUDE.md`).
Human-facing docs: `README.md`; contribution process: `CONTRIBUTING.md`.

## Commands

- `bun run dev [path]`: run from source
- `bun test`: all tests (they use real temp git repos and the project's TypeScript 7 `tsc --lsp`)
- `bun run typecheck`: `tsc --noEmit`
- `bun run format`: `bun fmt src test` (settings in `bunfig.toml`; CI runs `format:check`)
- `bun run install:cli`: build the binary and install `ce` (a running `ce` then offers a restart)
- `bun run native`: build OpenTUI's native library with `patches/opentui-native@<version>.patch` and put it in `node_modules` (needs Zig 0.16.0; cached, so quick after the first time). Run it after every `bun install` that touches OpenTUI; the Khmer cases in `test/app/widthMethod.test.ts` fail without it.

## OpenTUI patches

copane patches OpenTUI twice; both must be re-created on an OpenTUI upgrade (or dropped once upstream has the fix):
- `patches/@opentui%2Fcore@<version>.patch` (`bun patch`): the parser worker takes an injection's language from `#set! injection.language`.
- `patches/opentui-native@<version>.patch` (Zig, applied to the OpenTUI repo at tag `v<version>` by `scripts/opentui-native.sh`): in `unicode-wide`, a letter cluster gets a cell per letter and spacing sign, as Windows Terminal and xterm.js draw it (Khmer `ក្កា` is 3 cells); the wide Khmer letters ឃ ញ ឈ ណ ឍ យ ល ស ហ ឤ get a spare cell that the next sign of their cluster uses (`ណ` 2, `ណា` 2), and the renderer blanks a cluster's cells and places the next cell itself (`explicit_cursor_positioning` on), since the terminal counts one. CI and the release build it per platform.

## Bun first

Use Bun's own APIs. Fall back to `node:` modules only where Bun has no equivalent.

| Need | Use | Not |
| --- | --- | --- |
| Read a file | `await Bun.file(p).text()` / `.bytes()` / `.json()` | `fs.readFile(Sync)` |
| Exists / size / mtime | `await Bun.file(p).exists()`, `.size`, `await Bun.file(p).stat()` | `fs.existsSync`, `fs.statSync` |
| Write a file (creates folders) | `await Bun.write(p, data)` (also copies: `Bun.write(dest, Bun.file(src))`) | `fs.writeFile` + `mkdir` |
| Delete a file | `await Bun.file(p).delete()` | `fs.rm` / `unlink` |
| Run a process | `Bun.spawn` / `Bun.spawnSync`; output: `await Bun.readableStreamToText(p.stdout)` | `child_process`, `new Response(stream).text()` |
| Env | `Bun.env` | `process.env` |
| file:// URLs | `Bun.fileURLToPath` / `Bun.pathToFileURL` | `node:url` |
| Bytes | `Uint8Array`, `TextEncoder`/`TextDecoder`, `.toBase64()` | `Buffer` |
| Other built-ins | `Bun.which`, `Bun.sleep`, `Bun.hash`, `Bun.stringWidth` | hand-rolled versions |
| Tests | `bun:test` | jest/vitest |

Still on `node:`, because Bun has no API for them:
- `node:path`.
- `node:os` (`homedir`, `tmpdir`).
- `fs.watch` (`files/watcher.ts`).
- `readdir`, `mkdir`, `rename` (`files/walk.ts`, `files/fileOps.ts`, `ai/AgentProcess.ts`).
- `mkdtemp`, `chmod`, `rename`, `rm` for temp folders and replacing the binary (`setup/`).
- Synchronous reads where the caller is synchronous: the `.gitignore` read in `files/ignore.ts` (inside a sync matcher) and image sizes in `preview/MarkdownView.tsx` (during render).
- `node:zlib` in `test/support/png.ts` (PNG needs zlib-wrapped data).
- `appendFileSync` and `mkdirSync` in `app/shutdown.ts` (the error log: synchronous, it may be the last thing the process does).

## Terminal key gotchas

These apply to legacy terminal input, which is what most users have:
- **Ctrl+H** is Backspace.
- **Ctrl+Shift+letter** arrives as Ctrl+letter.
- **Shift+Enter** is Enter.
- **Alt+Shift+F** parses as Alt+→ (it is `ESC F`); `keyToString` maps it back by its raw sequence.
- **Cmd (Mac)** arrives only from kitty-protocol terminals, as `cmd+…`. Every `ctrl+…` binding also answers to Cmd (`cmdAsCtrl` in `keys.ts`), so don't add Cmd duplicates; Mac-only changes go in `macBindings` (`bindings.ts`), and UI text with key names goes through `keyText`/`useKeyText` so Macs see ⌘.

Use Alt or Ctrl+Alt combinations instead, and check new bindings with a quick key-parse test (see `test/` and how existing bindings were chosen).

## Where things live

| Folder | What |
| --- | --- |
| `src/main.tsx` | Startup: CLI flags, workspace, file watcher, language servers, git, restore after restart |
| `src/app/` | Layout (`App.tsx`), UI state (`state.ts`, a small `store.ts`), `workspace.ts` (the object every component gets), status bar, modals, palette, clipboard, restart/update |
| `src/editor/` | `BufferStore.ts` (open tabs: text, image and preview kinds), `EditorPane.tsx` (tabs + views), `CodeEditorRenderable.ts` (the text editor), highlighting, find, multi-cursor, line commands, merge of AI edits |
| `src/files/` | File tree (`TreeModel`, `FileTree`), watcher, `.gitignore` matching, Ctrl+P picker, project search, reveal in file manager |
| `src/git/` | `repo.ts` (git commands), source control panel, blame, history, branches, hunks, merge conflicts |
| `src/lsp/` | `LspManager.ts` (servers per language, documents, diagnostics), completion, hover, rename, references, formatting |
| `src/ai/` | The AI pane: a pseudo-terminal running the CLI (`AgentProcess`), and sending context to it |
| `src/keymap/` | `commands.ts` (every command, by id), `bindings.ts` (default keys per layer), `keys.ts` (key parsing), `appKeymap.ts` (routing on `@opentui/keymap`) |
| `src/preview/` | Markdown preview (own renderer on `marked`), image tabs, GIF playback |
| `src/config/` | Config schema (zod), loading, theme colours, VS Code settings import |
| `src/setup/` | `--upgrade` and `--install-font` |
| `test/` | Mirrors `src/`; `test/helpers.tsx` has `fixture()` (temp project) and `renderApp()` (renders the app headlessly) |

Main flows:
- Opening a file: `ws.buffers.open(path)` → `BufferStore` adds a buffer → `EditorPane` renders it (`BufferView`, `ImageView` or `MarkdownPreview` by `kind`).
- The AI edits a file: `FileWatcher` → `ws.buffers.handleDiskChange(path)` → clean buffers reload (undoable), dirty ones get a conflict bar.
- A key: `createAppKeymap` (`keymap/appKeymap.ts`, on OpenTUI's `@opentui/keymap` engine) matches it against the bindings of `bindings.ts`, one engine layer per focus layer (the focused one first, then global; only Quit under a dialog), then `runCommand(ws, id)` runs `commands[id]`.

## Adding a feature

- **A command:** add it to `commands.ts` with a `title` (the palette lists it automatically), and a key in `bindings.ts` if it needs one. Prefer VS Code's key; when a terminal can't send it, pick an Alt or Ctrl+Alt stand-in and add a row to the README's "Coming from VS Code" table.
- **A key:** add a raw-bytes case to `test/keymap/keys.test.ts` proving the terminal sequence reaches the command.
- **A setting:** add it to `src/config/schema.ts` with a default and a comment, and to the README's config example.
- **Errors:** a UI action must never take the editor down (other files may be unsaved). Run menu and dialog actions through `safely()` (`app/safely.ts`), open files from lists with `openFile`/`openAt` (`app/navHistory.ts`, they turn failures into notices), and catch in fire-and-forget (`void …`) calls. Anything uncaught still ends as a notice with a backup of unsaved work (`app/recovery.ts`), but it is a bug.
- **UI:** OpenTUI React elements (`<box>`, `<text>`, `<span>`, `<scrollbox>`, `<image>`, `<code>`). Colours come from `src/config/theme.ts`, never literals in components.
- **Syntax colours and highlights (OpenTUI 0.6):** native resources belong to a renderer. Components get the style with `useSyntaxStyle()`, extra highlight styles come from `extraStyle(name, def)` (`editor/syntaxStyle.ts`), and highlight refs (`hlRef`) must fit in 16 bits.

## Checking your work

1. `bun run typecheck`, `bun run format:check` and `bun test` pass. Add tests next to the existing ones: unit tests for logic, and `renderApp()` + `h.frame()` for what appears on screen (see `test/preview/preview.test.tsx` for the pattern). From `test/helpers.tsx`:
   - `waitUntil(cond, ms, render)` waits for async results and throws when they never come; never synchronise with a fixed `Bun.sleep`. Files wrap it as a local `until` that renders their harness.
   - `GIT_ENV` for git commands in tests (fixed author, no optional locks: a test's own `git status` must not take the index lock while the app commits).
   - `renderApp()` resets module-level state first (`resetModuleState()`); a new module-level store or cache gets a reset there too.
   - Tests with several waits call `setDefaultTimeout(15_000)` (Bun's default is 5 s).
2. Walk through the items in `scripts/smoke.md` your change touches, and add an item for new behaviour.
3. To see the real UI without a terminal of your own, record it with [vhs](https://github.com/charmbracelet/vhs): a tape that runs `bun run dev <path>` and takes a `Screenshot` (see `scripts/demo/demo.tape`). Clear inherited `CLAUDE*` variables first if you run inside Claude Code.
4. User-facing changes go in the README and under `Unreleased` in `CHANGELOG.md`.

## Direction: AI-first

Most code in a copane session is written by the AI in the side pane. The editor's job is to give the AI context, show what it changed, and make reviewing, accepting and undoing that easy. Prefer features that serve that loop (reviewing changes, sending context, watching agents) over aids for typing code by hand (multi-cursor variants, folding, inlay hints and the like), which are not planned. Reading aids for reviewing AI output (syntax highlighting, Markdown preview) are in. The pieces of that loop: `ai/turns.ts` records what each prompt changed, `ai/review.ts` keeps what is still unreviewed (gutter markers, Alt+N, accept / undo), `ai/askAi.ts` sends problems or diffs to the AI.

Also not planned: a terminal panel under the editor (the AI pane runs shell commands with `!`), and a debugger.
