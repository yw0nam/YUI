/**
 * Message-window name plate — the window's handle.
 *
 * The one surface that never leaves: a chip carrying the state dot, the name,
 * the state label and the dock button, and the grab target the OS window drag
 * starts from.
 */

import { subscribe as subscribeLocale, t } from "./i18n";

export interface MessagePlate {
  readonly el: HTMLElement;
  /** Speech streams — "responding" while set, outranking busy. */
  setLive(live: boolean): void;
  /** A turn runs — "thinking" while set, unless speech streams. */
  setBusy(busy: boolean): void;
  dispose(): void;
}

interface MessagePlateOptions {
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
    <span class="yui-plate__state"></span>
    <button class="yui-plate__dock" type="button">⤓</button>
  `;
  mount.prepend(el);

  const dockBtn = el.querySelector<HTMLButtonElement>(".yui-plate__dock")!;
  const stateEl = el.querySelector<HTMLSpanElement>(".yui-plate__state")!;

  let live = false;
  let busy = false;

  function applyState(): void {
    const state = live ? "responding" : busy ? "thinking" : "idle";
    el.dataset.state = state;
    stateEl.textContent =
      state === "thinking"
        ? t("plate.thinking")
        : state === "responding"
          ? t("plate.responding")
          : "";
  }

  function applyLocaleLabels(): void {
    dockBtn.setAttribute("aria-label", t("aria.dock_message"));
    dockBtn.setAttribute("title", t("aria.dock_message"));
    applyState();
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
    setLive(value) {
      live = value;
      applyState();
    },
    setBusy(value) {
      busy = value;
      applyState();
    },
    dispose() {
      unsubscribeLocale();
      el.removeEventListener("mousedown", onMouseDown);
      dockBtn.removeEventListener("click", onDock);
      el.remove();
    },
  };
}
