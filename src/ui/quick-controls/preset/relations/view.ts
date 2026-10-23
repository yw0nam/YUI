import type { RelationBand } from "../../../../contract/types";
import type { Relations } from "../../../../settings/relations/relations-store";

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
