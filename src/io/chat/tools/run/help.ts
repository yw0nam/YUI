/** The text help() prints inside a script: the yui API, the settings document generated from the table, the usage rules. */

import type { SettingScope, SettingTier } from "../../../../settings/agent-access/rows";

/** What help() prints per row; rows.ts rows and the io selection rows both satisfy it. */
export interface HelpRow {
  path: string;
  scope: SettingScope;
  tier: SettingTier;
  labelKey: string;
  type?: string;
  values?: readonly (string | number)[];
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  zeroIsDefault?: boolean;
  zeroNote?: string;
  note?: string;
}

export function helpText(_t: (key: string) => string, _extra: readonly HelpRow[] = []): string {
  return "";
}
