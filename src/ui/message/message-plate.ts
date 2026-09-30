/**
 * Message-window name plate — the window's handle.
 *
 * The one surface that never leaves: a chip carrying the state dot, the name,
 * the state label and the dock button, and the grab target the OS window drag
 * starts from.
 */

import { subscribe as subscribeLocale, t } from "../i18n";
import "./message-plate.css";

export interface MessagePlate {
  readonly el: HTMLElement;
  /** Speech streams — "responding" while set, outranking busy. */
  setLive(live: boolean): void;
  /** A turn runs — "thinking" while set, unless speech streams. */
  setBusy(busy: boolean): void;
  /** The transport behind this window — a non-"up" state outranks the turn state. */
  setConnection(conn: "up" | "reconnecting" | "failed"): void;
  dispose(): void;
}

interface MessagePlateOptions {
  mount: HTMLElement;
  /** Docks the surfaces back into the character window; without it the dock button is absent. */
  onDock?: () => void;
  /** Starts the OS window drag; without it the plate is not a grab target. */
  startDragging?: () => void;
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
    ${
      onDock
        ? `
    <button class="yui-plate__dock" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 14h6v6M10 14l-6 6M20 10h-6V4M14 10l6-6"/>
      </svg>
    </button>`
        : ""
    }
  `;
  mount.prepend(el);

  const dockBtn = el.querySelector<HTMLButtonElement>(".yui-plate__dock");
  const stateEl = el.querySelector<HTMLSpanElement>(".yui-plate__state")!;
  if (startDragging) el.dataset.draggable = "";

  let live = false;
  let busy = false;
  let conn: "up" | "reconnecting" | "failed" = "up";

  function applyState(): void {
    const state = live ? "responding" : busy ? "thinking" : "idle";
    el.dataset.state = state;
    stateEl.textContent =
      conn === "failed"
        ? t("plate.key_rejected")
        : conn === "reconnecting"
          ? t("plate.reconnecting")
          : state === "thinking"
            ? t("plate.thinking")
            : state === "responding"
              ? t("plate.responding")
              : "";
  }

  function applyLocaleLabels(): void {
    if (dockBtn) {
      dockBtn.setAttribute("aria-label", t("aria.dock_message"));
      dockBtn.setAttribute("title", t("aria.dock_message"));
    }
    applyState();
  }
  applyLocaleLabels();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  function onMouseDown(e: MouseEvent): void {
    if (!startDragging) return;
    if (e.button !== 0) return;
    if (dockBtn?.contains(e.target as Node)) return;
    startDragging();
  }

  const onDockClick = (): void => onDock?.();

  el.addEventListener("mousedown", onMouseDown);
  dockBtn?.addEventListener("click", onDockClick);

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
    setConnection(value) {
      conn = value;
      el.dataset.conn = value;
      applyState();
    },
    dispose() {
      unsubscribeLocale();
      el.removeEventListener("mousedown", onMouseDown);
      dockBtn?.removeEventListener("click", onDockClick);
      el.remove();
    },
  };
}
