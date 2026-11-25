import type { SettingsStores } from "../settings-stores";
import { setIn } from "./paths";
import type { SettingRow } from "./rows";

/** True when the row's store reads a candidate value back unchanged. */
export function validate(row: SettingRow, stores: SettingsStores, value: unknown): boolean {
  const candidate = setIn(
    stores[row.store].get(),
    row.field,
    row.toField ? row.toField(value) : value,
  );
  const store = row.factory({ load: () => candidate, save() {} });
  return JSON.stringify(store.get()) === JSON.stringify(candidate);
}
