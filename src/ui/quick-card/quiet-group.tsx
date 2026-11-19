/** The quick card's Quiet group: the Do not disturb switch, which writes the store on click and follows it live. */

import "../quick-controls/controls.css";
import type { Logger } from "../../logger";
import { fromExternal } from "./external";
import { tr } from "./locale";

export interface DndPort {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function QuietGroup(props: { dnd: DndPort; log: Logger }) {
  const on = fromExternal(
    () => props.dnd.get(),
    (cb) => props.dnd.subscribe(cb),
  );
  const toggle = (): void => {
    const enabled = !props.dnd.get();
    props.dnd.set(enabled);
    props.log.info("dnd_toggle", { enabled, via: "quick_card" });
  };
  return (
    <div class="yui-qcard__quiet">
      <p class="yui-qcard__quiet-title">{tr("quick_card.quiet")}</p>
      <div class="yui-qcard__quiet-group">
        <div class="yui-qcard__row">
          <span>{tr("quick_card.dnd")}</span>
          <button
            class="yui-switch"
            type="button"
            role="switch"
            aria-label={tr("quick_card.dnd")}
            aria-checked={on() ? "true" : "false"}
            onClick={toggle}
          />
        </div>
      </div>
    </div>
  );
}
