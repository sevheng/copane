import { useEffect, useMemo } from "react"
import { useRenderer } from "@opentui/react"
import { useWorkspace } from "../app/workspace"
import { createAppKeymap } from "./appKeymap"
import { buildBindings, sanitizeOverrides } from "./bindings"
import { macKeys } from "./platform"

/** The bindings (defaults, Mac changes and config overrides), routed by `createAppKeymap`. */
export function useAppKeymap(): ReturnType<typeof buildBindings> {
  const ws = useWorkspace()
  const renderer = useRenderer()
  const bindings = useMemo(() => {
    const { overrides, unknown } = sanitizeOverrides(ws.config.keys)
    if (unknown.length) setTimeout(() => ws.notify(`Unknown commands in config keys: ${unknown.join(", ")}`, "warn"), 0)
    return buildBindings(overrides, { mac: macKeys(ws.config) })
  }, [ws])
  useEffect(() => createAppKeymap(renderer, ws, bindings), [renderer, ws, bindings])
  return bindings
}
