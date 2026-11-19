/** The quick card's Quiet group: the Do not disturb switch, which writes the store on click and follows it live. */

import { useSyncExternalStore } from "react";
import "../quick-controls/controls.css";
import type { Logger } from "../../logger";
import { t } from "../i18n";

export interface DndPort {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function QuietGroup({ dnd, log }: { dnd: DndPort; log: Logger }) {
  const on = useSyncExternalStore(dnd.subscribe, dnd.get);
  return (
    <div className="yui-qcard__quiet">
      <p className="yui-qcard__quiet-title">{t("quick_card.quiet")}</p>
      <div className="yui-qcard__quiet-group">
        <div className="yui-qcard__row">
          <span>{t("quick_card.dnd")}</span>
          <button
            className="yui-switch"
            type="button"
            role="switch"
            aria-label={t("quick_card.dnd")}
            aria-checked={on}
            onClick={() => {
              const enabled = !dnd.get();
              dnd.set(enabled);
              log.info("dnd_toggle", { enabled, via: "quick_card" });
            }}
          />
        </div>
      </div>
    </div>
  );
}
