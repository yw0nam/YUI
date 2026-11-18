/** The quick card's Quiet group: the Do not disturb switch, which writes the store on click and follows it live. */

import "../quick-controls/controls.css";
import type { Logger } from "../../logger";
import { t } from "../i18n";

export interface DndPort {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function createQuietGroup(deps: { dnd: DndPort; log: Logger }): {
  el: HTMLElement;
  dispose(): void;
} {
  const { dnd, log } = deps;
  const el = document.createElement("div");
  el.className = "yui-qcard__quiet";
  el.innerHTML = `
    <p class="yui-qcard__quiet-title">${t("quick_card.quiet")}</p>
    <div class="yui-qcard__quiet-group">
      <div class="yui-qcard__row"><span>${t("quick_card.dnd")}</span><button class="yui-switch" type="button" role="switch" aria-label="${t("quick_card.dnd")}"></button></div>
    </div>`;
  const button = el.querySelector<HTMLButtonElement>(".yui-switch")!;
  const paint = (): void => button.setAttribute("aria-checked", String(dnd.get()));
  button.addEventListener("click", () => {
    const enabled = !dnd.get();
    dnd.set(enabled);
    log.info("dnd", { enabled, via: "quick_card" });
  });
  paint();
  return { el, dispose: dnd.subscribe(paint) };
}
