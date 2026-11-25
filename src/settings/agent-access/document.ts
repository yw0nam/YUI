import type { SettingsStores } from "../settings-stores";
import { getIn, leaves, setIn } from "./paths";
import { ROWS, type SettingTier } from "./rows";
import type { SettingRow } from "./rows";
import { validate } from "./validate";

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

/** What applying a patch consumes from a row; rows.ts rows and io rows both satisfy it. */
export interface PatchRow {
  path: string;
  tier: SettingTier;
  labelKey: string;
  nullable?: boolean;
  /** The row's own acceptance check, where the store-clamp probe does not apply. */
  valid?(stores: SettingsStores, value: unknown): boolean;
  read(stores: SettingsStores): unknown;
  write(stores: SettingsStores, value: unknown): void;
}

/** Every exposed setting of this character and the global ones, as one document. */
export function readDocument(stores: SettingsStores, rows: readonly PatchRow[] = ROWS): Record<string, unknown> {
  let document: Record<string, unknown> = {};
  for (const row of rows) {
    document = setIn(document, row.path.split("."), row.read(stores)) as Record<string, unknown>;
  }
  return document;
}

/** Merges a JSON merge patch into the document and applies each changed leaf. */
export function applyPatch(stores: SettingsStores, patch: object, rows: readonly PatchRow[] = ROWS): PatchResult {
  const document = readDocument(stores);
  const patchLeaves = leaves(patch);
  const direct: Record<string, "ok" | `error: ${string}`> = {};
  const allow: SettingsChange[] = [];

  for (const leaf of patchLeaves) {
    const path = leaf.keys.join(".");
    const row = leaf.keys.some((key) => key.includes("."))
      ? undefined
      : rows.find((entry) => entry.path === path);
    if (!row) {
      direct[path] = `error: unknown ${path}`;
      continue;
    }
    if (JSON.stringify(row.read(stores)) === JSON.stringify(leaf.value)) {
      direct[path] = "ok";
      continue;
    }
    if (leaf.value === null) {
      if (!row.nullable) {
        direct[path] = `error: invalid ${path}`;
        continue;
      }
      row.write(stores, null);
      direct[path] = "ok";
      continue;
    }
    if (!validate(row as SettingRow, stores, leaf.value)) {
      direct[path] = `error: invalid ${path}`;
      continue;
    }
    if (row.tier === "allow") {
      allow.push({
        path,
        labelKey: row.labelKey,
        from: getIn(document, leaf.keys),
        to: leaf.value,
      });
      continue;
    }
    row.write(stores, leaf.value);
    direct[path] = "ok";
  }

  return { direct, allow };
}
