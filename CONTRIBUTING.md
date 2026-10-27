# Contributing to copane

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Setup

You need [Bun](https://bun.sh) 1.4.4 or later, [Zig](https://ziglang.org/download/) 0.16.0, git, and a Linux or macOS terminal (WSL works).

```sh
git clone https://github.com/sevheng/copane.git
cd copane
bun install
bun run native       # OpenTUI's native library with copane's patch (see AGENTS.md)
bun run dev [path]   # run from source; Ctrl+Alt+R restarts it with your changes
```

## Before you open a pull request

- `bun run typecheck` and `bun run format:check` pass.
- `bun test` passes. Tests use real temporary git repos and the project's TypeScript 7 `tsc --lsp`, so they take about a minute.
- New behaviour has a test next to the existing ones in `test/`, mirroring `src/`.
- Walk through the items in [`scripts/smoke.md`](scripts/smoke.md) your change touches. They cover what tests can't, such as a real terminal, tmux and the clipboard.
- User-facing changes are described in the README and listed under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md).

Keep pull requests focused: one fix or feature each.

## Contributing with an AI agent

Agent-written pull requests are welcome. copane is built that way itself.

1. Pick an issue labelled [`agent-friendly`](https://github.com/sevheng/copane/labels/agent-friendly) or [`good first issue`](https://github.com/sevheng/copane/labels/good%20first%20issue). Each one names the files to start from and what "done" means.
2. Point your agent (Claude Code, Codex, Copilot, Cursor, Gemini CLI, Aider…) at the issue. It reads [`AGENTS.md`](AGENTS.md) for the project's rules and architecture; Claude Code reads it through `CLAUDE.md`.
3. You own the result. Read the diff, run `bun run typecheck`, `bun test` and the smoke items yourself, and try the change in a real terminal.
4. Say in the pull request that an AI helped, and keep to one issue per pull request.

## Conventions

[`AGENTS.md`](AGENTS.md) has the full list. The two that matter most:

- **Bun first.** Use Bun's APIs (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.env`) and fall back to `node:` modules only where Bun has none.
- **Terminal keys.** Legacy terminals can't send many combinations: Ctrl+H is Backspace, Ctrl+Shift+letter arrives as Ctrl+letter, and Shift+Enter is Enter. New bindings use Alt or Ctrl+Alt, and come with a key-parse test.

Match the style of the code around you. Comments explain *why*, not *what*.

## Performance and memory

- `bun run test/perf/typing.bench.tsx`: keystroke latency and CPU in a big file.
- `bun run test/perf/startup.bench.ts`: the watcher crawl and Ctrl+P index on a generated tree.
- `bun run test/perf/memory.bench.tsx`: private memory and JS heap after each part of a window (tree, Ctrl+P index, a highlighted file, git, an AI terminal). `FILE=path` opens another file, `HL=1` turns highlighting off.
- `CE_PERF=log` and `CE_MEM=log` on a running `ce` log keystroke timings and memory.

## Releasing (maintainers)

1. Bump `version` in `package.json`, and move the `Unreleased` notes in `CHANGELOG.md` under the new version.
2. Commit, then push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow builds Linux and macOS binaries (x64 and arm64) on native runners and publishes them with `SHA256SUMS`. `install.sh` and `copane --upgrade` pick up the new release automatically.
