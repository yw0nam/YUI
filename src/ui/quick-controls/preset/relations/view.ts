import type { RelationBand } from "../../../../contract/types";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import type { Relations } from "../../../../settings/relations/relations-store";

/** What the line and the card read: this preset's relations, as stored now. */
export interface RelationsView {
  /** This window's preset. */
  self: string;
  presets: readonly PresetEntry[];
  /** Keyed by preset id. */
  relations: Record<string, Relations>;
  /** `user` and every listed preset but `subject`, in registry order. */
  targetsOf(subject: string): string[];
  /** "you" for `user`, else the preset's name. */
  nameOf(id: string): string;
  /** "{subject}: {band} to {target}". */
  label(subject: string, target: string, band: RelationBand): string;
}
