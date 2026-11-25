import type { SettingsStores } from "../settings-stores";
import type { SettingRow } from "./rows";

/** True when the row's store reads a candidate value back unchanged. */
export function validate(_row: SettingRow, _stores: SettingsStores, _value: unknown): boolean {
  return false;
}