import type { SettingsStores } from "../settings-stores";
import { getIn, leaves, setIn } from "./paths";
import { ROWS, type SettingTier } from "./rows";

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
  /** The row's own acceptance check; rows.ts rows probe the store, io rows check their list. */
  valid(stores: SettingsStores, value: unknown): boolean;
  read(stores: SettingsStores): unknown;
  write(stores: SettingsStores, value: unknown): void | Promise<void>;
}

/** Every exposed setting of this character and the global ones, as one document. */
export function readDocument(
  stores: SettingsStores,
  rows: readonly PatchRow[] = ROWS,
): Record<string, unknown> {
  let document: Record<string, unknown> = {};
  for (const row of rows) {
    document = setIn(document, row.path.split("."), row.read(stores)) as Record<string, unknown>;
  }
  return document;
}

/** Applies one changed leaf; a rejecting write answers the failed-to-load error. */
export async function writeRow(
  row: PatchRow,
  stores: SettingsStores,
  value: unknown,
): Promise<"ok" | `error: ${string}`> {
  try {
    await row.write(stores, value);
    return "ok";
  } catch {
    return `error: ${row.path} failed to load`;
  }
}

/** Merges a JSON merge patch into the document and applies each changed leaf. */
export async function applyPatch(
  stores: SettingsStores,
  patch: object,
  rows: readonly PatchRow[] = ROWS,
): Promise<PatchResult> {
  const document = readDocument(stores, rows);
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
      direct[path] = await writeRow(row, stores, null);
      continue;
    }
    if (!row.valid(stores, leaf.value)) {
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
    direct[path] = await writeRow(row, stores, leaf.value);
  }

  return { direct, allow };
}
