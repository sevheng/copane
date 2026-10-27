import { homedir } from "node:os"
import { join } from "node:path"
import { tildify } from "./recent"

/**
 * Where copane keeps recent folders, layout, backups of unsaved work, review state and its error
 * log. Each of those writes fails quietly, so startup checks the folder once and says so.
 */
function stateBase(): string {
  return Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
}

/** A notice when copane can't write its state folder (null when it can). */
export async function stateDirProblem(base = stateBase()): Promise<string | null> {
  const probe = join(base, "copane", `.write-test-${process.pid}`)
  try {
    await Bun.write(probe, "")
    await Bun.file(probe).delete()
    return null
  } catch (err) {
    const code = (err as { code?: string }).code
    // A folder made by a `sudo` run belongs to root: handing it back is the usual fix.
    // Short: the status bar shows one line, and the command is the part to read.
    if (code === "EACCES" || code === "EPERM")
      return `Can't save recent folders or backups to ${tildify(base)}. Fix: sudo chown -R ${Bun.env.USER || "$USER"} ${tildify(base)}`
    return `Can't save recent folders or backups to ${tildify(base)} (${code ?? (err as Error).message})`
  }
}
