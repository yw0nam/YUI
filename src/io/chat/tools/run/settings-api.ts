/** yui.settings: the exposed settings document, and a patch whose allow paths wait for the user. */

import type { PatchRow, SettingsChange } from "../../../../settings/agent-access/document";
import { applyPatch, readDocument } from "../../../../settings/agent-access/document";
import { ROWS } from "../../../../settings/agent-access/rows";
import type { SettingsStores } from "../../../../settings/settings-stores";

export type SettingsAnswer = "allow" | "deny" | "no answer";

/** Asks the user once for every allow path of a write; the signal withdraws the ask. */
export type RequestSettings = (
  request: { changes: SettingsChange[]; why?: string },
  signal: AbortSignal,
) => Promise<SettingsAnswer>;

export type WriteResults = Record<string, "ok" | "denied" | "no answer" | `error: ${string}`>;

export interface SettingsApi {
  read(): Record<string, unknown>;
  write(patch: object, why: string | undefined, signal: AbortSignal): Promise<WriteResults>;
}

export function createSettingsApi(deps: {
  stores: SettingsStores;
  request: RequestSettings;
  /** Rows the io layer owns, alongside the settings-table rows. */
  rows?: readonly PatchRow[];
}): SettingsApi {
  const rows: readonly PatchRow[] = deps.rows?.length ? [...ROWS, ...deps.rows] : ROWS;
  return {
    read: () => readDocument(deps.stores, rows),
    write: async (patch, why, signal) => {
      const { direct, allow } = await applyPatch(deps.stores, patch, rows);
      const results: WriteResults = { ...direct };
      if (allow.length === 0) return results;
      const answer = await deps.request({ changes: allow, why }, signal);
      for (const change of allow) {
        if (answer !== "allow") {
          results[change.path] = answer === "deny" ? "denied" : "no answer";
          continue;
        }
        const row = rows.find((entry) => entry.path === change.path);
        if (!row?.valid(deps.stores, change.to)) {
          results[change.path] = `error: invalid ${change.path}`;
          continue;
        }
        await row.write(deps.stores, change.to);
        results[change.path] = "ok";
      }
      return results;
    },
  };
}
