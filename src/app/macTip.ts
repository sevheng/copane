import { homedir } from "node:os"
import { join } from "node:path"
import type { Workspace } from "./workspace"
import { isCmdReachable, macKeys } from "../keymap/platform"

/** Once per machine (~/.local/state/copane/mac-tip): how Mac keys work in this terminal. */
function tipPath(): string {
  const base = Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "copane", "mac-tip")
}

export async function showMacTip(ws: Workspace, path = tipPath()): Promise<void> {
  if (!macKeys(ws.config) || (await Bun.file(path).exists())) return
  ws.notify(
    isCmdReachable()
      ? "Mac keys: ⌘ for any ⌃ shortcut, ⌥←/→ by word (README › macOS)"
      : "Mac keys: this terminal doesn't send ⌘, so use ⌃. For ⌘C, ⌘S… run ce in Ghostty or iTerm2 (README › macOS)",
  )
  await Bun.write(path, "shown\n")
}
