import { onShutdown } from "./shutdown"
import { ITERM_PROFILE, itermProfilePath } from "../setup/terminals"

const setProfile = (name: string) => `\x1b]1337;SetProfile=${name}\x07`

/**
 * In iTerm2, show copane with the "copane" profile the font setup added (the Nerd Font, Option as
 * Alt), and give the tab its own profile back on exit. Deleting the profile file turns this off.
 */
export async function useItermProfile(
  env: Record<string, string | undefined> = Bun.env,
  write: (s: string) => void = (s) => process.stdout.write(s),
  path = itermProfilePath(),
): Promise<void> {
  const previous = env.ITERM_PROFILE
  if (env.TERM_PROGRAM !== "iTerm.app" || env.TMUX || !previous || previous === ITERM_PROFILE) return
  if (!(await Bun.file(path).exists())) return
  write(setProfile(ITERM_PROFILE))
  onShutdown(() => write(setProfile(previous)))
}
