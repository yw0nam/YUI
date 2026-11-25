/** yui.settings: the exposed settings document, and a patch whose allow paths wait for the user. */

import type { SettingsChange, PatchRow } from "../../../../settings/agent-access/document";
import { applyPatch, readDocument } from "../../../../settings/agent-access/document";
import { ROWS } from "../../../../settings/agent-access/rows";
import { validate } from "../../../../settings/agent-access/validate";
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
  rows?: readonly PatchRow[];
}): SettingsApi {
  return {
    read: () => readDocument(deps.stores),
    write: async (patch, why, signal) => {
      const { direct, allow } = applyPatch(deps.stores, patch);
      const results: WriteResults = { ...direct };
      if (allow.length === 0) return results;
      const answer = await deps.request({ changes: allow, why }, signal);
      for (const change of allow) {
        if (answer !== "allow") {
          results[change.path] = answer === "deny" ? "denied" : "no answer";
          continue;
        }
        const row = ROWS.find((entry) => entry.path === change.path);
        if (!row || !validate(row, deps.stores, change.to)) {
          results[change.path] = `error: invalid ${change.path}`;
          continue;
        }
        row.write(deps.stores, change.to);
        results[change.path] = "ok";
      }
      return results;
    },
  };
}
