/**
 * Reasoning disclosure — the backend's reasoning folded at the top of the speech bubble, under the quoted line.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the state the store holds. The disclosure
 * opens on the first delta of a live cycle, closes on every finalized render, and the summary
 * toggles it. The text is never spoken and never stored.
 */

import type { ReasoningStore } from "../../io/bridge/reasoning-store";
import { subscribe as subscribeLocale, t } from "../i18n";
import type { SpeechBubble } from "./speech-bubble";

/** The reasoning state as the disclosure reads it — the message window's mirror of the pet window's store. */
export type ReasoningSource = Pick<ReasoningStore, "get" | "subscribe">;

interface ReasoningDisclosureOptions {
  /** The speech text; the disclosure goes in right before it, under the quoted line. */
  before: HTMLElement;
  source: ReasoningSource;
  /** Revealed at a cycle's start, released at its end, re-measured as the disclosure changes height. */
  bubble: Pick<SpeechBubble, "reveal" | "release" | "measure">;
}

export function createReasoningDisclosure({ before, source, bubble }: ReasoningDisclosureOptions): {
  dispose(): void;
} {
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
  before.before(el);

  const labelEl = el.querySelector<HTMLElement>(".yui-bubble__think-label")!;
  const textEl = el.querySelector<HTMLElement>(".yui-bubble__think-text")!;
  let prevLive = false;

  function render(state: { text: string; live: boolean }): void {
    const cycleStart = !prevLive && state.live;
    const cycleEnd = prevLive && !state.live;
    prevLive = state.live;
    el.hidden = state.text === "";
    textEl.classList.toggle("is-live", state.live);
    textEl.textContent = state.text;
    if (cycleStart) {
      el.open = true;
      bubble.reveal();
    } else if (!state.live) el.open = false;
    if (state.live) textEl.scrollTop = textEl.scrollHeight;
    bubble.measure();
    if (cycleEnd) bubble.release(state.text !== "");
  }

  // Surfaces aren't remounted on locale change, so the label is (re)applied here.
  const applyLocaleLabel = (): void => {
    labelEl.textContent = t("think.chip");
  };
  applyLocaleLabel();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabel);
  const onToggle = (): void => bubble.measure();
  el.addEventListener("toggle", onToggle);
  const unsubscribeSource = source.subscribe(render);
  render(source.get());

  return {
    dispose(): void {
      el.removeEventListener("toggle", onToggle);
      unsubscribeSource();
      unsubscribeLocale();
      el.remove();
    },
  };
}
