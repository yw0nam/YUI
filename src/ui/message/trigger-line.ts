/**
 * Trigger line — why she spoke, on the bubble's first line.
 *
 * Pure renderer — firing ≠ judgment: it draws the line the dispatcher handed over and holds the
 * bubble open for the turn. The reply that follows is the backend's.
 */
import type { SpeechBubble } from "./speech-bubble";

export function createTriggerLine({
  el,
  bubble,
}: {
  el: HTMLElement;
  bubble: Pick<SpeechBubble, "holdForTurn" | "measure">;
}): { show(text: string): void } {
  return {
    show(text) {
      // Hold first: the speech that just started owns the reveal, and the hold keeps the slot through it.
      bubble.holdForTurn(true);
      el.classList.add("is-sources");
      const row = document.createElement("span");
      row.className = "yui-signal-line";
      const line = document.createElement("span");
      line.className = "yui-signal-line__text";
      line.textContent = text;
      row.append(line);
      el.replaceChildren(row);
      el.hidden = false;
      bubble.measure();
    },
  };
}
