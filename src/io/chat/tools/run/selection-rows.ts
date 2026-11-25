/** The per-character io selections exposed as direct setting rows: the VRM body and the speaker voice. */

import type { PatchRow } from "../../../../settings/agent-access/document";
import type { SettingRow } from "../../../../settings/agent-access/rows";

/** The part of a selection a yui_run row reads and writes; the swap loads before it commits. */
export interface SelectionPort {
  list(): { id: string; label?: string }[];
  getActiveId(): string;
  swap(id: string): Promise<void>;
}

export type SelectionRow = PatchRow & Pick<SettingRow, "scope" | "type" | "note">;

const selectionRow = (
  path: string,
  labelKey: string,
  note: string,
  selection: SelectionPort,
): SelectionRow => ({
  path,
  scope: "char",
  access: "direct",
  labelKey,
  type: "string",
  note,
  read: () => selection.getActiveId(),
  write: async (_stores, value) => {
    await selection.swap(value as string);
  },
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
