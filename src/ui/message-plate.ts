/**
 * Message-window name plate — the window's handle.
 *
 * The one surface that never leaves: a chip carrying the state dot, the name and
 * the dock button, and the grab target the OS window drag starts from.
 */

import { subscribe as subscribeLocale, t } from "./i18n";

export interface MessagePlate {
  readonly el: HTMLElement;
  /** Breathe the dot while speech streams. */
  setLive(live: boolean): void;
  dispose(): void;
}

export interface MessagePlateOptions {
  mount: HTMLElement;
  onDock(): void;
  startDragging(): void;
}

export function createMessagePlate({
  mount,
  onDock,
  startDragging,
}: MessagePlateOptions): MessagePlate {
  const el = document.createElement("div");
  el.className = "yui-plate";
  el.innerHTML = `
    <span class="yui-plate__dot" aria-hidden="true"></span>
    <span class="yui-plate__name">YUI</span>
    <button class="yui-plate__dock" type="button">⤓</button>
  `;
  mount.appendChild(el);

  const dockBtn = el.querySelector<HTMLButtonElement>(".yui-plate__dock")!;

  function applyLocaleLabels(): void {
    dockBtn.setAttribute("aria-label", t("aria.dock_message"));
    dockBtn.setAttribute("title", t("aria.dock_message"));
  }
  applyLocaleLabels();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (dockBtn.contains(e.target as Node)) return;
    startDragging();
  }

  el.addEventListener("mousedown", onMouseDown);
  dockBtn.addEventListener("click", onDock);

  return {
    el,
    setLive(live) {
      el.classList.toggle("is-live", live);
    },
    dispose() {
      unsubscribeLocale();
      el.removeEventListener("mousedown", onMouseDown);
      dockBtn.removeEventListener("click", onDock);
      el.remove();
    },
  };
}
