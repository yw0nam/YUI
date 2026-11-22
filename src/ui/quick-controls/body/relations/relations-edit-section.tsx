/** The Body page's Relations section: one row per target with a slider that sets this preset's relation by hand, shown while the Relations switch is on. */

import { useSyncExternalStore } from "react";
import { t } from "../../../i18n";
import { ratedInOrder, targetName } from "../../preset/relations/view";
import "./relations-edit.css";
import { RelationRow } from "./relation-row";
import type { RelationsPort } from "./relations-port";

export function RelationsEditSection({ store, enabled, self, presets, log }: RelationsPort) {
  const own = useSyncExternalStore(store.subscribe, store.current);
  const on = useSyncExternalStore(enabled.subscribe, enabled.current);
  // The presets are read on each render and not subscribed: a rename shows on the next open or write.
  const list = presets();
  const nameOf = (id: string): string => targetName(id, list);
  const targets = ["user", ...list.map((p) => p.id).filter((id) => id !== self)];
  const rated = ratedInOrder(targets, own);
  const ordered = [...rated, ...targets.filter((id) => !own[id])];
  return (
    <div className="yui-sec yui-relations">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("relations.section")}</h2>
      </div>
      <p className="yui-sec__note yui-relations__note" hidden={!on}>
        {t("relations.note", { name: nameOf(self) })}
      </p>
      <p className="yui-sec__note yui-relations__off" hidden={on}>
        {t("relations.off_note")}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: the row group the panel's shared row CSS styles */}
      <div
        className="yui-group yui-relations__rows"
        role="group"
        aria-label={t("relations.section")}
        hidden={!on}
      >
        {ordered.map((target, i) => (
          <RelationRow
            key={target}
            target={target}
            name={nameOf(target)}
            selfName={nameOf(self)}
            record={own[target]}
            firstUnrated={i === rated.length}
            store={store}
            log={log}
          />
        ))}
      </div>
    </div>
  );
}
