/** The per-character io selections exposed as direct setting rows: the VRM body and the speaker voice. */

import type { PatchRow } from "../../../../settings/agent-access/document";
import type { SettingScope } from "../../../../settings/agent-access/rows";

/** The part of a selection store a yui_run row reads and writes. */
export interface SelectionPort {
  list(): { id: string; label?: string }[];
  getActiveId(): string;
  select(id: string): void;
}

interface SelectionRow extends PatchRow {
  scope: SettingScope;
}

export function selectionRows(_deps: { vrm: SelectionPort; speaker: SelectionPort }): SelectionRow[] {
  return [];
}
