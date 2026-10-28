/** The Plugins page's catalog: its load, the updates it offers, and "Check for updates". */

import type { CatalogEntry, McpHostManage, PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import type { CatalogView } from "./catalog-markup";
import type { CheckState } from "./installed-markup";

/** How long "Check for updates" shows its result. */
const CHECK_RESULT_MS = 4000;

export interface CatalogState {
  /** The list state and the entries whose id is not installed. */
  list(installed: ReadonlySet<string>): Pick<CatalogView, "state" | "entries" | "error">;
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
  render: () => void;
}): CatalogState {
  const { manage, plugins, render } = deps;
  let state: CatalogView["state"] = "loading";
  let entries: CatalogEntry[] = [];
  let error = "";
  let inFlight: Promise<void> | null = null;
  let checked: CheckState = null;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;

  function updateTo(p: PluginHostPlugin): string | null {
    if (p.source === "local" || state !== "ok") return null;
    const entry = entries.find((c) => c.id === p.id);
    return entry?.version && p.version && entry.version !== p.version ? entry.version : null;
  }

  function load(): Promise<void> {
    if (inFlight) return inFlight;
    // A list already shown stays while it reloads.
    if (state !== "ok") state = "loading";
    render();
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
        render();
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
      void load().then(() => {
        checked = state === "ok" ? { updates: plugins().filter((p) => updateTo(p)).length } : null;
        render();
        checkTimer = setTimeout(() => {
          checked = null;
          render();
        }, CHECK_RESULT_MS);
      });
    },
    dispose: () => clearTimeout(checkTimer),
  };
}
