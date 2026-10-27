import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core"
import { Keymap, type KeymapHost } from "@opentui/keymap"
import { registerEnabledFields } from "@opentui/keymap/addons"
import { createOpenTuiKeymapHost } from "@opentui/keymap/opentui"
import type { Workspace } from "../app/workspace"
import { completionVisible } from "../lsp/CompletionPopup"
import { SEARCH_PANEL_KEYS } from "../files/SearchPanel"
import { lookup, type buildBindings, type Layer } from "./bindings"
import { runCommand } from "./commands"
import { cmdAsCtrl, keyLabel, keyToString } from "./keys"
import { isCmdReachable, macKeys } from "./platform"

const WAITING = "Waiting for the second key..."

/**
 * Global key routing on OpenTUI's keymap engine. copane's bindings (keyToString form, chords as
 * "ctrl+k ctrl+c") become one layer per copane layer; the focused one comes before "global", as
 * `layersFor` lists them. A key the engine matches is preventDefault()-ed and never reaches the
 * textarea or the AI terminal. Modals handle their own keys: under one, only Quit is live.
 *
 * A key that starts a chord (Ctrl+K in "ctrl+k ctrl+c") waits for the next key, as in VS Code.
 * Returns a function that removes it all.
 */
export function createAppKeymap(renderer: CliRenderer, ws: Workspace, bindings: ReturnType<typeof buildBindings>): () => void {
  const offs: (() => void)[] = []
  // OpenTUI's host, but listening where useKeyboard does (after the handlers already there, as
  // before), and without raw input or key releases, which copane doesn't bind.
  const base = createOpenTuiKeymapHost(renderer)
  const host: KeymapHost<Renderable, KeyEvent> = {
    get metadata() {
      return base.metadata
    },
    rootTarget: base.rootTarget,
    get isDestroyed() {
      return base.isDestroyed
    },
    getFocusedTarget: () => base.getFocusedTarget(),
    getParentTarget: (t) => base.getParentTarget(t),
    isTargetDestroyed: (t) => base.isTargetDestroyed(t),
    onKeyPress(listener) {
      renderer.keyInput.on("keypress", listener)
      const off = () => void renderer.keyInput.off("keypress", listener)
      offs.push(off)
      return off
    },
    onKeyRelease: () => () => {},
    onFocusChange: (l) => base.onFocusChange(l),
    onTargetDestroy: (t, l) => base.onTargetDestroy(t, l),
    createCommandEvent: () => base.createCommandEvent(),
  }
  const keymap = new Keymap(host)
  registerEnabledFields(keymap)
  const pretty = (keys: string) => keyLabel(keys, { mac: macKeys(ws.config), cmd: isCmdReachable() })

  // Bindings are copane's own key strings: each key of a chord matches as itself.
  offs.push(
    keymap.appendBindingParser((ctx) => {
      if (ctx.index !== 0) return undefined
      const parts = ctx.input
        .trim()
        .split(/\s+/)
        .map((k) => {
          const mods = k.split("+")
          const name = mods.pop()!
          const stroke = {
            name,
            ctrl: mods.includes("ctrl"),
            shift: mods.includes("shift"),
            meta: mods.includes("alt"),
            super: mods.includes("cmd"),
          }
          return ctx.parseObjectKey(stroke, { display: k, match: ctx.createMatch(k) })
        })
      return { parts, nextIndex: ctx.input.length }
    }),
  )

  const inSearch = () => {
    const ui = ws.ui.get()
    return ui.focus === "tree" && ui.sidebar === "search"
  }
  // An event matches its keyToString form, then (Cmd held) the Ctrl binding it stands for. Keys
  // copane leaves alone match nothing.
  offs.push(
    keymap.prependEventMatchResolver((event, ctx) => {
      const k = keyToString(event)
      const ui = ws.ui.get()
      // An open completion list takes Tab to accept.
      if (!ui.modal && k === "tab" && ui.focus === "editor" && completionVisible()) return []
      // The SEARCH tab of the left pane owns its typing and its own keys (Ctrl+F: replace row...).
      if (!ui.modal && inSearch() && !keymap.hasPendingSequence() && SEARCH_PANEL_KEYS.has(k)) return []
      const ctrl = cmdAsCtrl(k)
      return ctrl ? [ctx.resolveKey(k), ctx.resolveKey(ctrl)] : [ctx.resolveKey(k)]
    }),
  )

  const layerOn = (layer: Layer) => () => {
    const ui = ws.ui.get()
    if (ui.modal) return false
    // While the find bar has the keyboard, editing keys (Ctrl+Z, Ctrl+A...) belong to its input.
    const layers: Layer[] =
      ui.focus === "ai" ? ["ai"] : (ui.focus === "editor" && ui.find?.active) || inSearch() ? ["global"] : [ui.focus, "global"]
    return layers.includes(layer)
  }
  for (const layer of ["global", "editor", "tree", "ai"] as Layer[])
    offs.push(
      keymap.registerLayer({
        priority: layer === "global" ? 0 : 1,
        enabled: layerOn(layer),
        bindings: [...bindings[layer]].map(([key, id]) => ({ key, cmd: () => void runCommand(ws, id) })),
      }),
    )
  // Quit works under any dialog (it still asks about unsaved files), as the too-small screen promises.
  offs.push(
    keymap.registerLayer({
      priority: 2,
      enabled: () => ws.ui.get().modal !== null,
      bindings: [...bindings.global]
        .filter(([key]) => lookup(bindings.global, key) === "app.quit")
        .map(([key]) => ({
          key,
          cmd: () => {
            ws.ui.set({ modal: null })
            void runCommand(ws, "app.quit")
          },
        })),
    }),
  )

  let chord: string | null = null
  offs.push(
    keymap.intercept("key", () => {
      const ui = ws.ui.get()
      // A dialog opened mid-chord: drop it.
      if (ui.modal && keymap.hasPendingSequence()) keymap.clearPendingSequence()
      // A cursor parked by the wheel comes back before any key acts on it.
      if (!ui.modal && ui.focus === "editor")
        (ws.buffers.active?.textarea as { unpark?: () => void } | null | undefined)?.unpark?.()
    }),
  )
  offs.push(
    keymap.on("pendingSequence", (sequence) => {
      if (sequence.length) {
        chord = sequence.map((p) => p.display).join(" ")
        ws.notify(`${pretty(chord)} was pressed. ${WAITING}`)
      } else if (ws.ui.get().notice?.text.endsWith(WAITING)) {
        // The chord is done: drop "waiting for the second key" (quiet commands would leave it up).
        ws.ui.set({ notice: null })
      }
    }),
  )
  offs.push(
    keymap.intercept("key:after", ({ event, reason, consume }) => {
      const k = keyToString(event)
      if (reason === "sequence-miss") {
        // The second key of a chord is used up either way.
        consume()
        if (k !== "escape" && chord) ws.notify(`${pretty(`${chord} ${k}`)} is not a command`)
        chord = null
        return
      }
      if (reason !== "no-match") return
      // An unbound Cmd+letter would reach the tree's single-letter keys (A: new file) as the letter.
      const ui = ws.ui.get()
      if (event.super && !ui.modal && ui.focus === "tree" && !inSearch() && cmdAsCtrl(k) !== null) consume()
    }),
  )

  return () => {
    for (const off of offs.reverse()) off()
  }
}
