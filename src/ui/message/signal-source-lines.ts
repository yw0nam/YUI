/**
 * Signal source lines — the signal groups a turn ran with, in the bubble's quote slot.
 *
 * Pure renderer — firing ≠ judgment: it draws the groups the dispatcher handed over and holds the
 * bubble open for the turn. The reply that follows is the backend's.
 */
import type { SourceLine } from "../../io/bridge/message/message-bridge";
import { t } from "../i18n";
import { renderSourceLine } from "../signals/source-line";
import type { SpeechBubble } from "./speech-bubble";

const MAX_LINES = 3;

export function createSignalSourceLines({
  el,
  bubble,
}: {
  el: HTMLElement;
  bubble: Pick<SpeechBubble, "holdForTurn" | "measure">;
}): { show(lines: SourceLine[]): void } {
  return {
    show(lines) {
      // Hold first: the speech that just started owns the reveal, and the hold keeps the slot through it.
      bubble.holdForTurn(true);
      el.classList.add("is-sources");
      const rows = lines.slice(0, MAX_LINES).map(renderSourceLine);
      if (lines.length > MAX_LINES) {
        const more = document.createElement("span");
        more.className = "yui-bubble__sources-more";
        more.textContent = t("bubble.sources_more", { n: lines.length - MAX_LINES });
        rows.push(more);
      }
      el.replaceChildren(...rows);
      el.hidden = false;
      bubble.measure();
    },
  };
}
