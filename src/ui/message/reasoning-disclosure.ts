/**
 * Reasoning disclosure — the backend's reasoning folded at the top of the speech bubble.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the state the store holds. The disclosure
 * opens on the first delta of a live cycle, closes on every finalized render, and the summary
 * toggles it. The text is never spoken and never stored.
 */

import type { ReasoningStore } from "../../io/bridge/reasoning-store";
import { subscribe as subscribeLocale, t } from "../i18n";

/** The reasoning state as the disclosure reads it — the pet window's store or a window's mirror. */
export type ReasoningSource = Pick<ReasoningStore, "get" | "subscribe">;

interface ReasoningDisclosureOptions {
  /** The bubble's box; the disclosure goes in before the speech text. */
  mount: HTMLElement;
  source: ReasoningSource;
  /** Called on the first delta of a live cycle. */
  onCycleStart(): void;
}

export function createReasoningDisclosure({
  mount,
  source,
  onCycleStart,
}: ReasoningDisclosureOptions): { dispose(): void } {
  const el = document.createElement("details");
  el.className = "yui-bubble__think";
  el.hidden = true;
  el.innerHTML = `
    <summary>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6"/>
      </svg>
      <span class="yui-bubble__think-label"></span>
    </summary>
    <p class="yui-bubble__think-text"></p>
  `;
  mount.prepend(el);

  const labelEl = el.querySelector<HTMLElement>(".yui-bubble__think-label")!;
  const textEl = el.querySelector<HTMLElement>(".yui-bubble__think-text")!;
  let prevLive = false;

  function render(state: { text: string; live: boolean }): void {
    const cycleStart = !prevLive && state.live;
    prevLive = state.live;
    if (state.text === "") {
      el.hidden = true;
      el.open = false;
      return;
    }
    el.hidden = false;
    textEl.classList.toggle("is-live", state.live);
    textEl.textContent = state.text;
    if (cycleStart) {
      el.open = true;
      onCycleStart();
    } else if (!state.live) el.open = false;
    if (state.live) textEl.scrollTop = textEl.scrollHeight;
  }

  // Surfaces aren't remounted on locale change, so the label is (re)applied here.
  const applyLocaleLabel = (): void => {
    labelEl.textContent = t("think.chip");
  };
  applyLocaleLabel();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabel);
  const unsubscribeSource = source.subscribe(render);
  render(source.get());

  return {
    dispose(): void {
      unsubscribeSource();
      unsubscribeLocale();
      el.remove();
    },
  };
}
