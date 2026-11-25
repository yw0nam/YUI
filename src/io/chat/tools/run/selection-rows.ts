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
  /** An id; help() prints it as string. */
  type: string;
  /** Where the id comes from. */
  note: string;
}

export type { SelectionRow };

const selectionRow = (
  path: string,
  labelKey: string,
  note: string,
  selection: SelectionPort,
): SelectionRow => ({
  path,
  scope: "char",
  tier: "direct",
  labelKey,
  type: "string",
  note,
  read: () => selection.getActiveId(),
  write: (_stores, value) => selection.select(value as string),
  valid: (_stores, value) => selection.list().some((option) => option.id === value),
});

export function selectionRows(deps: {
  vrm: SelectionPort;
  speaker: SelectionPort;
}): SelectionRow[] {
  return [
    selectionRow("character.body", "run.body_label", "id from yui.info.read().bodies", deps.vrm),
    selectionRow(
      "character.voice",
      "run.voice_label",
      "id from yui.info.read().voices",
      deps.speaker,
    ),
  ];
}
