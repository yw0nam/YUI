import type { SettingsStores } from "../settings-stores";
import { getIn, leaves, setIn } from "./paths";
import { ROWS } from "./rows";
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

/** Every exposed setting of this character and the global ones, as one document. */
export function readDocument(stores: SettingsStores): Record<string, unknown> {
  let document: Record<string, unknown> = {};
  for (const row of ROWS) {
    document = setIn(document, row.path.split("."), row.read(stores)) as Record<string, unknown>;
  }
  return document;
}

/** Merges a JSON merge patch into the document and applies each changed leaf. */
export function applyPatch(stores: SettingsStores, patch: object): PatchResult {
  const document = readDocument(stores);
  const patchLeaves = leaves(patch);
  const direct: Record<string, "ok" | `error: ${string}`> = {};
  const allow: SettingsChange[] = [];

  for (const leaf of patchLeaves) {
    const path = leaf.keys.join(".");
    const row = leaf.keys.some((key) => key.includes("."))
      ? undefined
      : ROWS.find((entry) => entry.path === path);
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
    if (!validate(row, stores, leaf.value)) {
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
