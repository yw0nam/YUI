import type { SettingsStores } from "../settings-stores";
import { setIn } from "./paths";
import type { SettingRow } from "./rows";

/** The fields the store-probe check reads from a row. */
type ValidatableRow = Pick<SettingRow, "store" | "field" | "toField" | "factory" | "maxLength">;

/** True when the row's store reads a candidate value back unchanged, and the string fits the row's cap. */
export function validate(row: ValidatableRow, stores: SettingsStores, value: unknown): boolean {
  if (row.maxLength !== undefined && typeof value === "string" && value.length > row.maxLength) {
    return false;
  }
  const candidate = setIn(
    stores[row.store].get(),
    row.field,
    row.toField ? row.toField(value) : value,
  );
  const store = row.factory({ load: () => candidate, save() {} });
  return JSON.stringify(store.get()) === JSON.stringify(candidate);
}
