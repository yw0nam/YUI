import type { RelationBand } from "../../../../contract/types";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import type { Relations } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";

/** "you" for `user`, else the preset's name, else the id. */
export function targetName(id: string, presets: readonly PresetEntry[]): string {
  return id === "user" ? t("relation.to_you") : (presets.find((p) => p.id === id)?.name ?? id);
}

/** The rated targets: "you" first, then by value, close first; ties keep registry order. */
export function ratedInOrder(targets: readonly string[], own: Relations): string[] {
  return targets
    .filter((id) => own[id])
    .sort((a, b) => (a === "user" ? -1 : b === "user" ? 1 : own[b]!.value - own[a]!.value));
}

/** What the line and the card read: this preset's relations, as stored now. */
export interface RelationsView {
  /** This window's preset. */
  self: string;
  /** This preset's relations, as stored now. */
  own: Relations;
  /** "user" and every other registry preset, in registry order. */
  targets: readonly string[];
  /** "you" for `user`, else the preset's name. */
  nameOf(id: string): string;
  /** "{self}: {band} to {target}". */
  label(target: string, band: RelationBand): string;
}
