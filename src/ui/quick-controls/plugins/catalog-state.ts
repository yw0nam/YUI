/** The Plugins page's catalog: its load, the updates it offers, and "Check for updates". */

import type { CatalogEntry, McpHostManage, PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import { SOURCES } from "./plugin-sources";

/** How long "Check for updates" shows its result. */
const CHECK_RESULT_MS = 4000;

/** "Check for updates": idle, the catalog reload in flight, or its result. */
export type CheckState = null | "busy" | { updates: number };

/** The list's state and the entries whose id is not installed. */
export interface CatalogList {
  state: "loading" | "error" | "ok";
  entries: CatalogEntry[];
  /** The host's rejection when `state` is `error`. */
  error: string;
}

export interface CatalogState {
  /** The list state and the entries whose id is not installed. */
  list(installed: ReadonlySet<string>): CatalogList;
  /** Loads the catalog; a call while a load is in flight joins it. */
  load(): Promise<void>;
  /** The catalog version an update would install; null when none is due. */
  updateTo(plugin: PluginHostPlugin): string | null;
  checkState(): CheckState;
  /** Reloads the catalog, then shows the count of updates for a while. */
  check(): void;
  dispose(): void;
}

export function createCatalogState(deps: {
  manage: Pick<McpHostManage, "catalog">;
  plugins: () => PluginHostPlugin[];
  notify: () => void;
}): CatalogState {
  const { manage, plugins, notify } = deps;
  let state: CatalogList["state"] = "loading";
  let entries: CatalogEntry[] = [];
  let error = "";
  let inFlight: Promise<void> | null = null;
  let checked: CheckState = null;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function updateTo(p: PluginHostPlugin): string | null {
    if (!SOURCES[p.source].fromCatalog || state !== "ok") return null;
    const entry = entries.find((c) => c.id === p.id);
    return entry?.version && p.version && entry.version !== p.version ? entry.version : null;
  }

  function load(): Promise<void> {
    if (inFlight) return inFlight;
    // A list already shown stays while it reloads.
    if (state !== "ok") state = "loading";
    notify();
    inFlight = manage
      .catalog()
      .then(
        (loaded) => {
          entries = loaded;
          state = "ok";
        },
        (err) => {
          state = "error";
          error = String(err);
        },
      )
      .finally(() => {
        inFlight = null;
        notify();
      });
    return inFlight;
  }

  return {
    list: (installed) => ({
      state,
      entries: entries.filter((c) => !installed.has(c.id)),
      error,
    }),
    load,
    updateTo,
    checkState: () => checked,
    check: () => {
      checked = "busy";
      notify();
      void load().then(() => {
        if (disposed) return;
        checked = state === "ok" ? { updates: plugins().filter((p) => updateTo(p)).length } : null;
        notify();
        checkTimer = setTimeout(() => {
          checked = null;
          notify();
        }, CHECK_RESULT_MS);
      });
    },
    dispose: () => {
      disposed = true;
      clearTimeout(checkTimer);
    },
  };
}
