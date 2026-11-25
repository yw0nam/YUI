import { isPlainObject } from "../persisted-store";
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
  const merged = merge(document, patch);
  const direct: Record<string, "ok" | `error: ${string}`> = {};
  const allow: SettingsChange[] = [];

  for (const leaf of leaves(patch)) {
    const parts = leaf.path.split(".");
    const row = ROWS.find((entry) => entry.path === leaf.path);
    if (!row) {
      direct[leaf.path] = `error: unknown ${leaf.path}`;
      continue;
    }
    if (leaf.value === null) {
      if (!row.nullable) {
        direct[leaf.path] = `error: invalid ${leaf.path}`;
        continue;
      }
      row.write(stores, null);
      direct[leaf.path] = "ok";
      continue;
    }
    if (!validate(row, stores, leaf.value)) {
      direct[leaf.path] = `error: invalid ${leaf.path}`;
      continue;
    }
    if (row.tier === "allow") {
      allow.push({
        path: leaf.path,
        labelKey: row.labelKey,
        from: getIn(document, parts),
        to: getIn(merged, parts),
      });
      continue;
    }
    row.write(stores, leaf.value);
    direct[leaf.path] = "ok";
  }

  return { direct, allow };
}

/** RFC 7396: a null deletes a member, a nested object merges, anything else replaces. */
function merge(target: unknown, patch: object): Record<string, unknown> {
  const out = isPlainObject(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isPlainObject(value)) out[key] = merge(out[key], value);
    else out[key] = value;
  }
  return out;
}
