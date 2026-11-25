/** yui.settings: the exposed settings document, and a patch whose allow paths wait for the user. */

import type { SettingsChange } from "../../../../settings/agent-access/document";
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

export function createSettingsApi(_deps: {
  stores: SettingsStores;
  request: RequestSettings;
}): SettingsApi {
  return { read: () => ({}), write: async () => ({}) };
}
