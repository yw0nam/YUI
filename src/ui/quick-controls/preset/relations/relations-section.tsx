/** The preset header's relations: the relation line, the reasons card, and the motion of a changed relation. */

import { type RefObject, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { RelationBand } from "../../../../contract/types";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import {
  bandOf,
  type Relations,
  type RelationsStore,
} from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { useSnapshot } from "../../../use-snapshot/use-snapshot";
import { useReasonsCard } from "./reasons-card";
import { bandShift, restart } from "./relation-glyph";
import { observeWidth, RelationLine } from "./relation-line";
import { type RelationsView, targetName } from "./view";

/** Moves the relations of every pair of this preset whose value changed between two writes. */
function paint(header: HTMLElement, self: string, previous: Relations, next: Relations): void {
  for (const [target, record] of Object.entries(next)) {
    const before = previous[target];
    if (before?.value === record.value) continue;
    const relations = header.querySelectorAll<HTMLElement>(
      `.yui-relation[data-subject="${self}"][data-target="${target}"]`,
    );
    for (const relation of relations) {
      if (before)
        bandShift(
          relation.querySelector(".yui-glyph")!,
          bandOf(before.value),
          bandOf(record.value),
        );
      else restart(relation, "is-entering");
      restart(relation, "is-fresh");
    }
  }
}

export function PresetRelations({
  header,
  self,
  store,
  presets,
  isOpen,
  relationsSwitch,
  closeOn,
}: {
  header: RefObject<HTMLElement | null>;
  /** The preset the window edits, whose relations show. */
  self: string;
  store: RelationsStore;
  presets: readonly PresetEntry[];
  /** Whether the preset's window is open in this app. */
  isOpen: (id: string) => boolean;
  /** The Relations switch; off, the line hides. */
  relationsSwitch: FlagSettingsStore;
  /** The header's own sources; the card closes when one changes. */
  closeOn: readonly unknown[];
}) {
  const own = useSnapshot(store.all, store.subscribe);
  const { enabled } = useSnapshot(relationsSwitch.get, relationsSwitch.subscribe);
  // Only a width change refolds; the height an unfolded line gains must not.
  const [width, widthChanged] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => (header.current ? observeWidth(header.current, widthChanged) : undefined),
    [header],
  );

  const nameOf = (id: string): string => targetName(id, presets);
  const view: RelationsView = {
    self,
    own,
    targets: ["user", ...presets.map((p) => p.id).filter((id) => id !== self)],
    nameOf,
    label: (target, band: RelationBand) =>
      t("relation.card_head", {
        subject: nameOf(self),
        band: t(`relation.band.${band}`),
        target: nameOf(target),
      }),
  };
  const card = useReasonsCard({
    header,
    recordOf: (subject, target) => (subject === self ? own[target] : undefined),
    nameOf,
    closeOn: [...closeOn, own, enabled, width],
  });

  const previous = useRef(own);
  useLayoutEffect(() => {
    if (header.current) paint(header.current, self, previous.current, own);
    previous.current = own;
  }, [header, self, own]);

  return (
    <>
      <RelationLine
        view={view}
        isOpen={isOpen}
        hidden={!enabled}
        describedBy={(target) => card.describedBy(self, target)}
        handlers={card.handlers}
      />
      {card.card}
    </>
  );
}
