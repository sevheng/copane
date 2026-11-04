import { commands, type CommandId } from "./commands"
import { cmdAsCtrl, keyLabel, normalizeBinding } from "./keys"

export type Layer = "global" | "editor" | "tree" | "ai"

/** Default bindings. Keys use normalizeBinding() form. */
const defaultBindings: Record<Layer, Record<string, CommandId>> = {
  global: {
    "ctrl+q": "app.quit",
    "ctrl+s": "file.save",
    "ctrl+p": "file.picker",
    "ctrl+b": "view.toggleSidebar",
    // VS Code's Ctrl+Shift+E arrives as Ctrl+E (focus.editor).
    "alt+e": "focus.tree",
    "ctrl+e": "focus.editor",
    "ctrl+j": "focus.ai",
    "ctrl+w": "buffer.close",
    "ctrl+pagedown": "buffer.next",
    "ctrl+pageup": "buffer.prev",
    f1: "app.palette",
    "ctrl+shift+p": "app.palette",
    "ctrl+alt+p": "app.palette",
    "ctrl+alt+k": "app.help",
    "ctrl+l": "ai.sendContext",
    "ctrl+alt+r": "app.restart",
    // VS Code's Ctrl+R (Open Recent) is "reload from disk" here.
    "ctrl+alt+o": "file.openRecent",
    "ctrl+alt+j": "view.toggleAi",
    "ctrl+alt+m": "view.maximizeEditor",
    "ctrl+alt+x": "view.maximizeAi",
    "ctrl+f": "find.open",
    "ctrl+shift+h": "find.replace",
    "ctrl+g": "edit.gotoLine",
    "ctrl+alt+f": "search.files",
    "ctrl+shift+f": "search.files",
    "ctrl+alt+d": "git.changes",
    "ctrl+alt+z": "ai.turns",
    // Not in the AI pane: CLIs use Alt+letters there (Claude Code's Alt+P picks the model).
    "alt+n": "ai.nextChange",
    "alt+p": "ai.prevChange",
    // Also from the AI pane, where you are when the AI finishes ("view the changes").
    "ctrl+alt+v": "ai.nextChange",
    "ctrl+alt+n": "ai.newAgent",
    "ctrl+alt+pagedown": "ai.nextAgent",
    "ctrl+alt+pageup": "ai.prevAgent",
    "ctrl+alt+g": "git.fileHistory",
    "ctrl+alt+b": "git.branches",
    "ctrl+alt+t": "buffer.reopenClosed",
    "ctrl+shift+t": "buffer.reopenClosed",
    "ctrl+t": "file.symbolInProject",
    // Ctrl+Shift+O arrives as Ctrl+O in most terminals.
    "ctrl+o": "file.symbolInFile",
    "ctrl+shift+o": "file.symbolInFile",
    "alt+1": "buffer.goto1",
    "alt+2": "buffer.goto2",
    "alt+3": "buffer.goto3",
    "alt+4": "buffer.goto4",
    "alt+5": "buffer.goto5",
    "alt+6": "buffer.goto6",
    "alt+7": "buffer.goto7",
    "alt+8": "buffer.goto8",
    "alt+9": "buffer.goto9",
    // VS Code's Ctrl+K chords.
    "ctrl+k ctrl+s": "app.help",
    "ctrl+k z": "view.maximizeEditor",
    "ctrl+k s": "file.saveAll",
    "ctrl+k v": "markdown.togglePreviewSide",
    "ctrl+k f": "ai.fixProblems",
    "ctrl+k e": "ai.fixTerminalError",
    // VS Code's Ctrl+` arrives as Ctrl+Space (NUL) in most terminals.
    "alt+`": "ai.newTerminal",
    "ctrl+k d": "ai.reviewChanges",
    "alt+shift+v": "markdown.openPreview",
    "alt+left": "nav.back",
    "alt+right": "nav.forward",
    "ctrl+alt+left": "nav.back",
    "ctrl+alt+right": "nav.forward",
    "ctrl+alt+e": "lsp.problems",
    f8: "lsp.nextProblem",
    f12: "lsp.definition",
  },
  editor: {
    "ctrl+c": "edit.copy",
    "ctrl+x": "edit.cut",
    "ctrl+v": "edit.paste",
    "ctrl+a": "edit.selectAll",
    "ctrl+r": "buffer.reloadFromDisk",
    "ctrl+z": "edit.undo",
    "ctrl+y": "edit.redo",
    "ctrl+shift+z": "edit.redo",
    "ctrl+space": "lsp.complete",
    "ctrl+alt+i": "lsp.hover",
    "alt+z": "view.wordWrap",
    "ctrl+d": "edit.addOccurrence",
    "alt+h": "git.peekHunk",
    // GitLens' "Toggle File Blame".
    "alt+b": "git.toggleFileBlame",
    "alt+f5": "git.nextChange",
    "alt+shift+f5": "git.prevChange",
    "ctrl+alt+a": "edit.allOccurrences",
    f2: "lsp.rename",
    // Ctrl+. reaches us only from terminals that send CSI-u keys; Alt+. works everywhere.
    "ctrl+.": "lsp.quickFix",
    "alt+.": "lsp.quickFix",
    "alt+shift+o": "lsp.organizeImports",
    "shift+f12": "lsp.references",
    "ctrl+alt+l": "lsp.format",
    "alt+shift+f": "lsp.format",
    // Ctrl+/ arrives as Ctrl+_ in most terminals (the same byte as Ctrl+7).
    "ctrl+/": "edit.toggleComment",
    "ctrl+_": "edit.toggleComment",
    // Line keys sit where VS Code (Windows/Linux) has them.
    "alt+up": "edit.moveLineUp",
    "alt+down": "edit.moveLineDown",
    "alt+shift+up": "edit.duplicateLineUp",
    "alt+shift+down": "edit.duplicateLineDown",
    "ctrl+alt+up": "edit.duplicateLineUp",
    "ctrl+alt+down": "edit.duplicateLineDown",
    // Ctrl+Shift+K arrives as Ctrl+K (a chord prefix here), so Alt+Shift+K comes first.
    "alt+shift+k": "edit.deleteLine",
    // In the tree, the tree reveals its selected row itself.
    "alt+shift+r": "file.revealInOS",
    "ctrl+shift+k": "edit.deleteLine",
    tab: "edit.indent",
    "shift+tab": "edit.outdent",
    "ctrl+]": "edit.indentLine",
    "ctrl+k ctrl+c": "edit.addComment",
    "ctrl+k ctrl+u": "edit.removeComment",
    "ctrl+k ctrl+x": "edit.trimWhitespace",
    "ctrl+k ctrl+i": "lsp.hover",
    "ctrl+k ctrl+f": "lsp.format",
  },
  tree: {},
  // While the AI terminal is focused only these reach the editor; everything else goes to the CLI.
  // Ctrl+J (Claude's new line; Shift+Enter is plain Enter in most terminals) and Ctrl+B (Claude's
  // "run in background", the shell's cursor back) stay with the CLI: Ctrl+E goes back to the editor.
  ai: {
    "ctrl+q": "app.quit",
    "ctrl+e": "focus.editor",
    "ctrl+p": "file.picker",
    f1: "app.palette",
    "ctrl+alt+r": "app.restart",
    "ctrl+alt+j": "view.toggleAi",
    "ctrl+alt+x": "view.maximizeAi",
    "ctrl+alt+d": "git.changes",
    "ctrl+alt+z": "ai.turns",
    // Only in the AI pane: Ctrl+W there belongs to the CLI.
    "ctrl+alt+w": "ai.closeAgent",
    "ctrl+alt+v": "ai.nextChange",
    "ctrl+alt+n": "ai.newAgent",
    "alt+`": "ai.newTerminal",
    "ctrl+alt+pagedown": "ai.nextAgent",
    "ctrl+alt+pageup": "ai.prevAgent",
  },
}

/**
 * What changes on a Mac (keyStyle). Every Ctrl key also works with Cmd (see cmdAsCtrl); these are
 * the keys Mac terminals send for text navigation, and Mac-only extras. null removes a default.
 */
const macBindings: Partial<Record<Layer, Record<string, CommandId | null>>> = {
  global: {
    // Option+←/→ jumps a word (the textarea does it); Back/Forward stay on Ctrl+Option+←/→.
    "alt+left": null,
    "alt+right": null,
    // VS Code for Mac's Back/Forward (only from terminals that send CSI-u: Ctrl+- is Ctrl+_ otherwise).
    "ctrl+-": "nav.back",
    "ctrl+shift+-": "nav.forward",
    "cmd+1": "buffer.goto1",
    "cmd+2": "buffer.goto2",
    "cmd+3": "buffer.goto3",
    "cmd+4": "buffer.goto4",
    "cmd+5": "buffer.goto5",
    "cmd+6": "buffer.goto6",
    "cmd+7": "buffer.goto7",
    "cmd+8": "buffer.goto8",
    "cmd+9": "buffer.goto9",
    "cmd+shift+[": "buffer.prev",
    "cmd+shift+]": "buffer.next",
    "cmd+alt+left": "buffer.prev",
    "cmd+alt+right": "buffer.next",
  },
  editor: {
    // Option+← arrives as ESC b in Terminal.app and iTerm2: a word back, so blame moves to Alt+Shift+B.
    "alt+b": null,
    "alt+shift+b": "git.toggleFileBlame",
    // Ghostty and iTerm2 send Cmd+←/→ as Ctrl+A / Ctrl+E (as the shell reads them).
    "ctrl+a": "edit.lineStart",
    "ctrl+e": "edit.lineEnd",
    "cmd+a": "edit.selectAll",
  },
  ai: {
    // ⌘C copies the pane's selection, as in any Mac terminal; it never reaches the CLI as Ctrl+C.
    "cmd+c": "ai.copySelection",
  },
}

export function buildBindings(
  overrides: Partial<Record<Layer, Record<string, CommandId | null>>> = {},
  opts: { mac?: boolean } = {},
): Record<Layer, Map<string, CommandId>> {
  const out = {} as Record<Layer, Map<string, CommandId>>
  for (const layer of Object.keys(defaultBindings) as Layer[]) {
    const map = new Map<string, CommandId>()
    for (const [k, v] of Object.entries(defaultBindings[layer])) map.set(normalizeBinding(k), v)
    const mac = opts.mac ? (macBindings[layer] ?? {}) : {}
    for (const [k, v] of [...Object.entries(mac), ...Object.entries(overrides[layer] ?? {})]) {
      if (v === null) map.delete(normalizeBinding(k))
      else map.set(normalizeBinding(k), v)
    }
    out[layer] = map
  }
  return out
}

/** Validate user overrides from config; unknown command ids are reported, not applied. */
export function sanitizeOverrides(keys: Partial<Record<Layer, Record<string, string | null>>>): {
  overrides: Partial<Record<Layer, Record<string, CommandId | null>>>
  unknown: string[]
} {
  const overrides: Partial<Record<Layer, Record<string, CommandId | null>>> = {}
  const unknown: string[] = []
  for (const [layer, map] of Object.entries(keys) as [Layer, Record<string, string | null>][]) {
    const out: Record<string, CommandId | null> = {}
    for (const [k, v] of Object.entries(map ?? {})) {
      if (v === null || v in commands) out[k] = v as CommandId | null
      else unknown.push(v)
    }
    overrides[layer] = out
  }
  return { overrides, unknown }
}

/** The command a key runs in a layer: its own binding, else (Cmd held) the Ctrl one it stands for. */
export function lookup(map: Map<string, CommandId>, keys: string): CommandId | undefined {
  const id = map.get(keys)
  if (id) return id
  const ctrl = cmdAsCtrl(keys)
  return ctrl ? map.get(ctrl) : undefined
}

/** Whether a key starts a chord in a layer ("ctrl+k", or Cmd+K standing for it). */
export function startsChord(map: Map<string, CommandId>, key: string): boolean {
  const ctrl = cmdAsCtrl(key)
  return [...map.keys()].some((b) => b.startsWith(`${key} `) || (ctrl !== null && b.startsWith(`${ctrl} `)))
}

type Bindings = Record<Layer, Map<string, CommandId>>
const LAYERS: Layer[] = ["global", "editor", "tree", "ai"]

// What the Mac's terminals send these for (Ghostty, iTerm2): the key to show.
const MAC_SENT: Record<string, string> = { "ctrl+a": "⌘←", "ctrl+e": "⌘→" }

/** A binding as shown in the palette and help (⌘ on a Mac when Cmd reaches it). */
export function bindingLabel(bindings: Bindings, layer: Layer, keys: string, style: { mac: boolean; cmd: boolean }): string {
  if (style.mac && layer === "editor" && MAC_SENT[keys]) return MAC_SENT[keys]
  return keyLabel(keys, { ...style, taken: (cmd) => LAYERS.some((l) => bindings[l].has(cmd)) })
}

/** A layer's bindings worth showing: Cmd ones only when the terminal sends Cmd. */
export function shownBindings(bindings: Bindings, layer: Layer, style: { cmd: boolean }): [string, CommandId][] {
  return [...bindings[layer]].filter(([k]) => style.cmd || !k.split(/[ +]/).includes("cmd"))
}

/** Each command's shortcut for the palette: on a Mac, a Cmd one first. */
export function commandKeys(bindings: Bindings, style: { mac: boolean; cmd: boolean }): Map<CommandId, string> {
  const out = new Map<CommandId, string>()
  const cmdFirst = style.mac && style.cmd
  for (const pass of cmdFirst ? [true, false] : [false])
    for (const layer of LAYERS)
      for (const [k, id] of shownBindings(bindings, layer, style)) {
        if (out.has(id)) continue
        const label = bindingLabel(bindings, layer, k, style)
        if (!pass || label.includes("⌘")) out.set(id, label)
      }
  return out
}
