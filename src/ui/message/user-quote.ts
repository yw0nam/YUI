/**
 * User quote — the user's own message on the speech bubble's first line.
 *
 * Pure renderer — firing ≠ judgment: it draws the message the dispatcher admitted and holds the
 * bubble open while that turn runs. What the reply is, and whether there is one, is the backend's.
 */
import type { UserQuote } from "../../io/bridge/message-bridge";
import { subscribe as subscribeLocale, t } from "../i18n";
import type { SpeechBubble } from "./speech-bubble";

const MIC_ICON =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">` +
  `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;

interface UserQuoteOptions {
  /** The quote slot inside the bubble's box; the bubble hides it when the quote no longer applies. */
  el: HTMLElement;
  bubble: Pick<SpeechBubble, "reveal" | "release" | "measure" | "holdForTurn">;
}

export interface UserQuoteLine {
  /** A turn the user started was admitted: the line shows, the previous reply's text goes, the bubble holds. */
  show(quote: UserQuote): void;
  /** The quoted turn is over: the line stays, the hold drops, the bubble takes its dwell or hides when it shows nothing else. */
  settle(): void;
  /** The quoted turn ended before any reply: the line goes, the hold drops, the bubble hides when it shows nothing else. */
  clear(): void;
  dispose(): void;
}

export function createUserQuote({ el, bubble }: UserQuoteOptions): UserQuoteLine {
  el.innerHTML = `<span class="yui-bubble__quote-who"></span><span class="yui-bubble__quote-text"></span>`;
  const whoEl = el.querySelector<HTMLElement>(".yui-bubble__quote-who")!;
  const textEl = el.querySelector<HTMLElement>(".yui-bubble__quote-text")!;
  let via: UserQuote["via"] = "text";

  function renderWho(): void {
    whoEl.innerHTML = via === "voice" ? MIC_ICON : "";
    whoEl.append(t("bubble.you"));
  }

  function quoteText(quote: UserQuote): string {
    const attached = quote.images > 0 ? t("bubble.quote_attached", { count: quote.images }) : "";
    if (quote.text === "") return attached;
    return attached ? `${quote.text} (${attached})` : quote.text;
  }

  function show(quote: UserQuote): void {
    via = quote.via;
    // Hold first, so the reveal keeps the slot.
    bubble.holdForTurn(true);
    bubble.reveal({ clearSpeech: true });
    renderWho();
    textEl.textContent = quoteText(quote);
    el.hidden = false;
    bubble.measure();
  }

  function settle(): void {
    bubble.holdForTurn(false);
    bubble.release(!el.hidden);
  }

  function clear(): void {
    el.hidden = true;
    bubble.holdForTurn(false);
    bubble.release(false);
    bubble.measure();
  }

  // Surfaces aren't remounted on locale change, so the label is (re)applied here.
  renderWho();
  const unsubscribeLocale = subscribeLocale(renderWho);

  return {
    show,
    settle,
    clear,
    dispose(): void {
      unsubscribeLocale();
    },
  };
}
