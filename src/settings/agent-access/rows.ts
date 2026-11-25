import type { PersistedStorage } from "../persisted-store";
import type { SettingsStores } from "../settings-stores";

export type SettingScope = "char" | "global";
export type SettingTier = "direct" | "allow";

interface StoreGetter {
  get(): unknown;
}

/** One exposed setting: a scalar leaf of the settings document. */
export interface SettingRow {
  path: string;
  store: keyof SettingsStores;
  /** Path of the leaf inside its store's value. */
  field: readonly string[];
  scope: SettingScope;
  tier: SettingTier;
  labelKey: string;
  /** True when a null clears the row instead of invalidating it. */
  nullable?: boolean;
  read(stores: SettingsStores): unknown;
  write(stores: SettingsStores, value: unknown): void;
  factory(storage: PersistedStorage<any>): StoreGetter;
}

export const ROWS: readonly SettingRow[] = [];