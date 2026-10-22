import type { ClientContext } from "../../contract/types";
import type { PresetEntry } from "../preset/active-preset";
import { targetLabel } from "./relation-targets";
import { bandOf, type Relations } from "./relations-store";

/** This preset's stance entries: `user` first, then the other presets in registry order; unrated targets skipped. */
export function readStance(
  relations: Relations,
  selfId: string,
  presets: readonly PresetEntry[],
): NonNullable<ClientContext["stance"]> {
  const targets = [
    { id: "user", name: "user" },
    ...presets
      .filter((p) => p.id !== selfId)
      .map(({ id, name }) => ({ id, name: targetLabel(name) })),
  ];
  return targets.flatMap(({ id, name }) => {
    const record = relations[id];
    if (!record) return [];
    const last = record.log[0];
    return [
      {
        target: name,
        band: bandOf(record.value),
        delta: last?.delta ?? 0,
        why: last?.why ?? "",
        at: last?.at ?? record.updated_at,
        ...(record.note ? { note: record.note } : {}),
      },
    ];
  });
}
