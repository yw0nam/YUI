/** The preset strip's relations: the relation line and the reasons card. */

import type { RelationBand } from "../../../../contract/types";
import { type PresetEntry, presetIdForWindow } from "../../../../settings/preset/active-preset";
import {
  bandOf,
  type Relations,
  type RelationsStore,
} from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { createReasonsCard } from "./reasons-card";
import { bandShift, restart } from "./relation-glyph";
import { foldToWidth, relationLineEl, setUnfolded } from "./relation-line";
import type { RelationsView } from "./view";

export function createPresetRelations(deps: {
  strip: HTMLElement;
  /** The line goes right after this element. */
  anchor: HTMLElement;
  store: RelationsStore;
  presets: () => readonly PresetEntry[];
  /** Whether the preset's window is open in this app. */
  isOpen: (id: string) => boolean;
  /** The Relations switch; off, the line hides. */
  enabled: () => boolean;
  subscribeEnabled: (cb: () => void) => () => void;
}): { render(): void; dispose(): void } {
  const self = presetIdForWindow();
  let line: HTMLElement | null = null;
  let view: RelationsView | null = null;
  let previous: Relations = deps.store.all();

  function buildView(): RelationsView {
    const presets = deps.presets();
    const nameOf = (id: string): string =>
      id === "user" ? t("relation.to_you") : (presets.find((p) => p.id === id)?.name ?? id);
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
    line.hidden = !deps.enabled();
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
  const offEnabled = deps.subscribeEnabled(render);
  // Only a width change refolds; the height an unfolded line gains must not.
  let width = -1;
  const resize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(([entry]) => {
          if (!entry || entry.contentRect.width === width) return;
          width = entry.contentRect.width;
          render();
        })
      : null;
  resize?.observe(deps.strip);

  return {
    render,
    dispose(): void {
      offStore();
      offEnabled();
      resize?.disconnect();
      card.dispose();
      line?.remove();
    },
  };
}
