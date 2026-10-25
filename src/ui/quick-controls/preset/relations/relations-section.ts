/** The preset strip's relations: the relation line and the reasons card. */

import type { RelationBand } from "../../../../contract/types";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { type PresetEntry, presetIdForWindow } from "../../../../settings/preset/active-preset";
import {
  bandOf,
  type Relations,
  type RelationsStore,
} from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { createReasonsCard } from "./reasons-card";
import { bandShift, restart } from "./relation-glyph";
import { foldToWidth, observeWidth, relationLineEl, setUnfolded } from "./relation-line";
import { type RelationsView, targetName } from "./view";

export function createPresetRelations(deps: {
  strip: HTMLElement;
  /** The line goes right after this element. */
  anchor: HTMLElement;
  store: RelationsStore;
  presets: () => readonly PresetEntry[];
  /** Whether the preset's window is open in this app. */
  isOpen: (id: string) => boolean;
  /** The Relations switch; off, the line hides. */
  relationsSwitch: FlagSettingsStore;
}): { render(): void; dispose(): void } {
  const self = presetIdForWindow();
  let line: HTMLElement | null = null;
  let view: RelationsView | null = null;
  let previous: Relations = deps.store.all();

  function buildView(): RelationsView {
    const presets = deps.presets();
    const nameOf = (id: string): string => targetName(id, presets);
    return {
      self,
      own: deps.store.all(),
      targets: ["user", ...presets.map((p) => p.id).filter((id) => id !== self)],
      nameOf,
      label: (target, band: RelationBand) =>
        t("relation.card_head", {
          subject: nameOf(self),
          band: t(`relation.band.${band}`),
          target: nameOf(target),
        }),
    };
  }

  const card = createReasonsCard({
    strip: deps.strip,
    recordOf: (subject, target) => (subject === self ? view?.own[target] : undefined),
    nameOf: (id) => view?.nameOf(id) ?? id,
  });

  function render(): void {
    card.close();
    view = buildView();
    const nextLine = relationLineEl(view, deps.isOpen);
    const unfolded = line?.classList.contains("is-unfolded") ?? false;
    if (line) line.replaceWith(nextLine);
    else deps.anchor.after(nextLine);
    line = nextLine;
    line.hidden = !deps.relationsSwitch.get().enabled;
    // Measured folded, so the width fold holds; then the fold the user opened is restored.
    foldToWidth(line);
    setUnfolded(line, unfolded);
  }

  /** Moves the relations of every pair of this preset whose value changed since the last write. */
  function paint(next: Relations): void {
    for (const [target, record] of Object.entries(next)) {
      const before = previous[target];
      if (before?.value === record.value) continue;
      const relations = deps.strip.querySelectorAll<HTMLElement>(
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
    previous = next;
  }

  const offStore = deps.store.subscribe((next) => {
    render();
    paint(next);
  });
  const offEnabled = deps.relationsSwitch.subscribe(render);
  // Only a width change refolds; the height an unfolded line gains must not.
  const offWidth = observeWidth(deps.strip, render);

  return {
    render,
    dispose(): void {
      offStore();
      offEnabled();
      offWidth();
      card.dispose();
      line?.remove();
    },
  };
}
