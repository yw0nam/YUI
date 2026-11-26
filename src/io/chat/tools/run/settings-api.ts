/** yui.settings: the exposed settings document, and a patch whose allow paths wait for the user. */

import type { PatchRow, SettingsChange } from "../../../../settings/agent-access/document";
import { applyPatch, readDocument, writeRow } from "../../../../settings/agent-access/document";
import { ROWS } from "../../../../settings/agent-access/rows";
import type { SettingsStores } from "../../../../settings/settings-stores";

/** The user's decision on a write's allow paths: the paths allowed and their note, or no answer, or another request already waiting. */
export type SettingsDecision = { allow: readonly string[]; note?: string } | "no answer" | "busy";

/** Asks the user once for every allow path of a write; the signal withdraws the ask. */
export type RequestSettings = (
  request: { changes: SettingsChange[]; why?: string },
  signal: AbortSignal,
) => Promise<SettingsDecision>;

export type WriteResults = Record<
  string,
  "ok" | "denied" | "no answer" | `ok: ${string}` | `denied: ${string}` | `error: ${string}`
>;

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
      const decision = await deps.request({ changes: allow, why }, signal);
      for (const change of allow) {
        if (typeof decision === "string") {
          results[change.path] =
            decision === "busy" ? "error: a settings request is already waiting" : "no answer";
          continue;
        }
        const { note } = decision;
        if (!decision.allow.includes(change.path)) {
          results[change.path] = note ? `denied: ${note}` : "denied";
          continue;
        }
        const row = rows.find((entry) => entry.path === change.path);
        if (!row?.valid(deps.stores, change.to)) {
          results[change.path] = `error: invalid ${change.path}`;
          continue;
        }
        const written = await writeRow(row, deps.stores, change.to);
        results[change.path] = written === "ok" && note ? `ok: ${note}` : written;
      }
      return results;
    },
  };
}
