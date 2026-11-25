import type { SettingsStores } from "../settings-stores";

/** One allow-tier change an agent asked for, named by label key for the request card. */
export interface SettingsChange {
  path: string;
  labelKey: string;
  from: unknown;
  to: unknown;
}

export interface PatchResult {
  direct: Record<string, "ok" | `error: ${string}`>;
  allow: SettingsChange[];
}

/** Every exposed setting of this character and the global ones, as one document. */
export function readDocument(_stores: SettingsStores): Record<string, unknown> {
  return {};
}

/** Merges a JSON merge patch into the document and applies each changed leaf. */
export function applyPatch(_stores: SettingsStores, _patch: object): PatchResult {
  return { direct: {}, allow: [] };
}