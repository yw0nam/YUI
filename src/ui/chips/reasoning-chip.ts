/**
 * reasoning-chip — the backend's reasoning as a pill on the message window's plate row.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the state the store holds. The panel
 * opens on the first delta of a live cycle, closes on every render, and a tap toggles it.
 * The text is never spoken and never stored.
 */

import "./reasoning-chip.css";
import type { ReasoningState } from "../../io/bridge/reasoning-store";
import { subscribe as subscribeLocale, t } from "../i18n";

/** The reasoning state as the chip reads it — the pet window's store or a window's mirror. */
export interface ReasoningPort {
  get(): ReasoningState;
  subscribe(cb: (s: ReasoningState) => void): () => void;
}

export interface ReasoningChip {
  el: HTMLElement;
  /** Closes the panel without changing the text (the other chip opened). */
  closePanel(): void;
  /** Fires once per closed → open transition, from the automatic open or a tap. */
  onPanelOpen(cb: () => void): () => void;
  dispose(): void;
}

interface ReasoningChipOptions {
  mount: HTMLElement;
  store: ReasoningPort;
}

export function createReasoningChip({ mount, store }: ReasoningChipOptions): ReasoningChip {
  const el = document.createElement("div");
  el.className = "yui-think";
  el.hidden = true;
  el.innerHTML = `
    <button type="button" class="yui-think__chip" aria-expanded="false">
      <span class="yui-think__glyph" aria-hidden="true">💭</span>
      <span class="yui-think__label"></span>
      <span class="yui-think__caret" aria-hidden="true">▾</span>
    </button>
    <div class="yui-think__panel" hidden><p class="yui-think__text"></p></div>
  `;
  mount.appendChild(el);

  const chipBtn = el.querySelector<HTMLButtonElement>(".yui-think__chip")!;
  const labelEl = el.querySelector<HTMLElement>(".yui-think__label")!;
  const caretEl = el.querySelector<HTMLElement>(".yui-think__caret")!;
  const panelEl = el.querySelector<HTMLElement>(".yui-think__panel")!;
  const textEl = el.querySelector<HTMLElement>(".yui-think__text")!;

  let panelOpen = false;
  let prevLive = false;
  const openSubs = new Set<() => void>();

  function openPanel(): void {
    if (panelOpen) return;
    panelOpen = true;
    chipBtn.setAttribute("aria-expanded", "true");
    caretEl.textContent = "▴";
    panelEl.hidden = false;
    for (const cb of [...openSubs]) cb();
  }

  function closePanel(): void {
    if (!panelOpen) return;
    panelOpen = false;
    chipBtn.setAttribute("aria-expanded", "false");
    caretEl.textContent = "▾";
    panelEl.hidden = true;
  }

  function render(state: ReasoningState): void {
    if (state.text === "") {
      el.hidden = true;
      closePanel();
      prevLive = state.live;
      return;
    }
    el.hidden = false;
    chipBtn.classList.toggle("is-live", state.live);
    textEl.classList.toggle("is-live", state.live);
    textEl.textContent = state.text;
    // The first delta of a cycle opens; every render closes, including a manual open.
    if (!prevLive && state.live) openPanel();
    else if (!state.live) closePanel();
    if (state.live) textEl.scrollTop = textEl.scrollHeight;
    prevLive = state.live;
  }

  function onClick(): void {
    if (panelOpen) closePanel();
    else openPanel();
  }

  chipBtn.addEventListener("click", onClick);

  // Created outside main.ts's locale remount set, so the labels re-apply here.
  const unsubscribeLocale = subscribeLocale(() => {
    labelEl.textContent = t("think.chip");
    chipBtn.setAttribute("aria-label", t("aria.think_toggle"));
  });
  labelEl.textContent = t("think.chip");
  chipBtn.setAttribute("aria-label", t("aria.think_toggle"));

  const unsubscribeStore = store.subscribe(render);
  render(store.get());

  function dispose(): void {
    unsubscribeStore();
    unsubscribeLocale();
    openSubs.clear();
    chipBtn.removeEventListener("click", onClick);
    el.remove();
  }

  return {
    el,
    closePanel,
    onPanelOpen(cb): () => void {
      openSubs.add(cb);
      return () => {
        openSubs.delete(cb);
      };
    },
    dispose,
  };
}
