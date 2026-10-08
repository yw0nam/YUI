/**
 * Speech bubble — dwell/scroll/markdown/aria for streamed backend speech.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the text handed to it.
 * Judgment (whether/what to speak) is the backend's.
 */

import type { SpeechAction } from "../../io/bridge/message/message-remote";
import { subscribe as subscribeLocale, t } from "../i18n";
import { afterFadeOut } from "../notices/fade-out";
import { renderMarkdownInline } from "./markdown";

export interface SpeechBubble {
  /** Reveal the bubble (empty) + caret ON. Called before streaming starts. */
  beginSpeech(): void;
  /** Append a streaming delta. */
  pushSpeech(delta: string): void;
  /**
   * Caret OFF. By default, auto-fades after dwell (also used when the full text arrives at once).
   * When defer=true, the fade is held — the bubble stays until TTS playback ends and finishSpeech() is called.
   */
  endSpeech(opts?: { defer?: boolean }): void;
  /** Release a deferred bubble (endSpeech defer) into dwell→fade. No-op if not deferred/hidden. */
  finishSpeech(): void;
  /** Hide the bubble immediately (ignoring dwell). */
  hideSpeech(): void;
  /** Offers an in-place fix under the current speech; without an action, drops the one shown. */
  showSpeechAction(action?: SpeechAction): void;
  /** Show the bubble for content other than speech, holding off any pending fade; speech is left as it is unless `clearSpeech` drops it. */
  reveal(opts?: { clearSpeech?: boolean }): void;
  /**
   * Content other than speech settled. Speech still streaming or awaiting playback keeps its own exit;
   * otherwise a bubble with nothing to show hides, and one with content takes the dwell (or the hold).
   */
  release(hasContent: boolean): void;
  /** Re-measure the box after content other than speech changed its height. */
  measure(): void;
  /** While on, no dwell is armed: a turn the user started is still running. Turning it off arms nothing by itself; the caller releases. */
  holdForTurn(on: boolean): void;
  /** Lift the bubble above the input by totalOffsetPx (input bottom + input height + gap). */
  liftAboveInput(totalOffsetPx: number): void;
  /** Restore the bubble's default (input-closed) position. */
  resetPosition(): void;
  dispose(): void;
}

interface SpeechBubbleElements {
  /** overlay root (.yui-ui) — read for the --yui-dwell CSS token. */
  root: HTMLElement;
  /** Positioning wrapper — carries the state classes and the fade. */
  bubbleEl: HTMLElement;
  /** The scrolling panel inside the wrapper. */
  bubbleBox: HTMLElement;
  /** The quoted user line, the box's first child; user-quote.ts fills it, the bubble drops it. */
  bubbleQuote: HTMLElement;
  bubbleText: HTMLElement;
  /** The in-place fix button's slot, under the speech text; empty and hidden unless an action is offered. */
  bubbleAction: HTMLElement;
  /** Screen-reader-only announce region — the visual bubble is not live; once speech settles, announce once here. */
  bubbleSr: HTMLElement;
  /** Hover-revealed dismiss button on the bubble's edge. The bubble is pointer-events:none, so this is its own pointer target. */
  bubbleClose: HTMLElement;
}

const DEFAULT_DWELL = 5000;
const SPEECH_RENDER_INTERVAL_MS = 50;
// If the user is within this many px of the bottom, treat as pinned for auto-scroll.
const SCROLL_PIN_SLACK_PX = 8;

export function createSpeechBubble(
  {
    root,
    bubbleEl,
    bubbleBox,
    bubbleQuote,
    bubbleText,
    bubbleAction,
    bubbleSr,
    bubbleClose,
  }: SpeechBubbleElements,
  dwellMs?: number,
  /** When it returns true, speech never auto-fades — the bubble holds until dismissed or replaced. */
  keepUntilDismissed?: () => boolean,
): SpeechBubble {
  const dwell = dwellMs ?? readDwellToken(root) ?? DEFAULT_DWELL;
  const holdOpen = (): boolean => keepUntilDismissed?.() ?? false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  // Whether the fade is being held by endSpeech({ defer:true }) — finishSpeech() releases it.
  let deferred = false;
  // Raw accumulated speech text — rendered as markdown at a bounded cadence.
  let speechRaw = "";
  let lastRenderAt = Number.NEGATIVE_INFINITY;
  // Whether the user is hovering over the bubble to read it.
  let hovering = false;
  // Whether a dwell debt remains (timer-arming can be held).
  let dwellArmed = false;
  // Whether the user dismissed this utterance — the rest of its stream stays hidden.
  let dismissed = false;
  // Whether revealed content other than speech is still arriving — the previous reply's end arms no dwell meanwhile.
  let revealHeld = false;
  // Whether a turn the user started is still running — the bubble arms no dwell meanwhile.
  let turnHeld = false;
  let cancelFade: (() => void) | null = null;
  let showFrame: number | null = null;
  // The current speech action's click — nulled with the slot so a stale button click does nothing.
  let speechActionClick: (() => void) | null = null;

  function clearDwell(): void {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  // Arm dwell — held while reading an overflowing bubble (leaves a debt without starting the timer).
  function armDwell(): void {
    clearDwell();
    if (hovering && bubbleEl.classList.contains("is-scrollable")) return;
    dwellTimer = setTimeout(() => {
      dwellArmed = false;
      hideSpeech();
    }, dwell);
  }

  // Arm the transition on the next frame (won't animate in the same frame right after clearing hidden).
  function showNextFrame(): void {
    if (showFrame !== null) cancelAnimationFrame(showFrame);
    showFrame = requestAnimationFrame(() => {
      showFrame = null;
      bubbleEl.classList.add("is-visible");
    });
  }

  // A hide landing before that frame must not be undone by it.
  function cancelShowFrame(): void {
    if (showFrame !== null) cancelAnimationFrame(showFrame);
    showFrame = null;
  }

  function isPinnedToEnd(): boolean {
    return (
      bubbleBox.scrollHeight - bubbleBox.scrollTop - bubbleBox.clientHeight <= SCROLL_PIN_SLACK_PX
    );
  }

  // Scroll a height-capped bubble to the end so the latest line stays visible (keeps position if pin=false).
  // Only toggle is-scrollable on overflow so the top fade applies (short speech doesn't clip its first line).
  function scrollBubbleToEnd(pin = true): void {
    if (pin) bubbleBox.scrollTop = bubbleBox.scrollHeight;
    measure();
  }

  function measure(): void {
    bubbleEl.classList.toggle("is-scrollable", bubbleBox.scrollHeight > bubbleBox.clientHeight);
  }

  function beginSpeech(): void {
    clearDwell();
    deferred = false;
    dismissed = false;
    revealHeld = false;
    bubbleEl.classList.remove("is-held");
    speechRaw = "";
    lastRenderAt = Number.NEGATIVE_INFINITY;
    bubbleText.replaceChildren();
    bubbleSr.textContent = "";
    clearSpeechAction();
    if (!turnHeld) bubbleQuote.hidden = true;
    bubbleEl.hidden = false;
    bubbleEl.classList.add("is-streaming");
    showNextFrame();
  }

  function reveal(opts?: { clearSpeech?: boolean }): void {
    clearDwell();
    dwellArmed = false;
    revealHeld = true;
    if (cancelFade || opts?.clearSpeech) {
      // The fade was about to drop this speech; drop it now so it doesn't return beside the new content.
      cancelFade?.();
      cancelFade = null;
      speechRaw = "";
      bubbleText.replaceChildren();
      clearSpeechAction();
      bubbleEl.classList.remove("is-streaming");
    }
    if (!turnHeld) bubbleQuote.hidden = true;
    bubbleEl.hidden = false;
    showNextFrame();
  }

  function release(hasContent: boolean): void {
    revealHeld = false;
    if (turnHeld) return;
    if (bubbleEl.hidden || cancelFade || deferred) return;
    if (bubbleEl.classList.contains("is-streaming")) return;
    if (!hasContent && speechRaw === "") {
      hideSpeech();
      return;
    }
    settleIntoDwell();
  }

  function pushSpeech(delta: string): void {
    if (dismissed) return;
    if (bubbleEl.hidden) beginSpeech();
    speechRaw += delta;
    const now = performance.now();
    if (now - lastRenderAt < SPEECH_RENDER_INTERVAL_MS) return;
    // Measure before updating — don't yank down a user who has scrolled up to read.
    const pin = isPinnedToEnd();
    bubbleText.replaceChildren(renderMarkdownInline(speechRaw));
    lastRenderAt = now;
    scrollBubbleToEnd(pin);
  }

  function endSpeech(opts?: { defer?: boolean }): void {
    if (dismissed) return;
    if (bubbleEl.hidden && speechRaw === "") return;
    const pin = isPinnedToEnd();
    if (speechRaw !== "") bubbleText.replaceChildren(renderMarkdownInline(speechRaw));
    bubbleEl.hidden = false;
    bubbleEl.classList.add("is-visible");
    bubbleEl.classList.remove("is-streaming");
    scrollBubbleToEnd(pin);
    // Announce once, when speech settles — not on every delta or barge-in re-call.
    if (bubbleSr.textContent !== bubbleText.textContent) {
      bubbleSr.textContent = bubbleText.textContent;
    }
    clearDwell();
    if (opts?.defer) {
      // Hold the fade until playback ends — finishSpeech() arms the dwell.
      deferred = true;
      return;
    }
    deferred = false;
    settleIntoDwell();
  }

  function finishSpeech(): void {
    if (!deferred) return;
    deferred = false;
    if (bubbleEl.hidden) return;
    settleIntoDwell();
  }

  // Held speech never fades — mark it so the close button (its only exit) stays visible.
  // A shown speech action holds the bubble the same way.
  function hold(): boolean {
    const on = holdOpen() || speechActionClick !== null;
    bubbleEl.classList.toggle("is-held", on);
    return on;
  }

  // A settled, visible bubble takes its dwell — unless something holds it open or speech is still in flight.
  function settleIntoDwell(): void {
    if (
      hold() ||
      deferred ||
      revealHeld ||
      turnHeld ||
      bubbleEl.classList.contains("is-streaming")
    ) {
      return;
    }
    dwellArmed = true;
    armDwell();
  }

  function hideSpeech(): void {
    clearDwell();
    dwellArmed = false;
    deferred = false;
    turnHeld = false;
    lastRenderAt = Number.NEGATIVE_INFINITY;
    cancelShowFrame();
    bubbleEl.classList.remove("is-visible", "is-streaming", "is-held");
    clearSpeechAction();
    cancelFade?.();
    cancelFade = afterFadeOut(bubbleEl, () => {
      cancelFade = null;
      if (!bubbleEl.classList.contains("is-visible")) {
        bubbleEl.hidden = true;
        speechRaw = "";
        bubbleText.replaceChildren();
        bubbleQuote.hidden = true;
      }
    });
  }

  function holdForTurn(on: boolean): void {
    turnHeld = on;
  }

  function clearSpeechAction(): void {
    speechActionClick = null;
    bubbleAction.replaceChildren();
    bubbleAction.hidden = true;
    measure();
  }

  function showSpeechAction(action?: SpeechAction): void {
    const wasShown = speechActionClick !== null;
    clearSpeechAction();
    // The action holds the bubble — a pending dwell must not drop it under the button.
    clearDwell();
    dwellArmed = false;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => speechActionClick?.());
      speechActionClick = action.onClick;
      bubbleAction.append(button);
      bubbleAction.hidden = false;
      measure();
      hold();
      return;
    }
    // The hold leaves with the action — the bubble takes its normal dwell again.
    if (wasShown) settleIntoDwell();
  }

  function liftAboveInput(totalOffsetPx: number): void {
    bubbleEl.style.setProperty("--yui-bubble-bottom", `${totalOffsetPx}px`);
    bubbleEl.classList.add("is-above-input");
  }

  function resetPosition(): void {
    bubbleEl.classList.remove("is-above-input");
    bubbleEl.style.removeProperty("--yui-bubble-bottom");
  }

  // Hovering an overflowing bubble pauses auto-hide to give time to read.
  function onBubbleEnter(): void {
    hovering = true;
    if (dwellArmed && bubbleEl.classList.contains("is-scrollable")) clearDwell();
  }
  function onBubbleLeave(): void {
    hovering = false;
    if (dwellArmed) armDwell();
  }

  // Dismissal outlives the utterance: the rest of a still-streaming reply must not re-open the bubble.
  function onCloseClick(): void {
    dismissed = true;
    hideSpeech();
  }

  // Surfaces aren't remounted on locale change, so the label is (re)applied here.
  function applyLocaleLabels(): void {
    bubbleClose.setAttribute("aria-label", t("aria.dismiss_bubble"));
    bubbleClose.setAttribute("title", t("aria.dismiss_bubble"));
  }
  applyLocaleLabels();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  bubbleEl.addEventListener("pointerenter", onBubbleEnter);
  bubbleEl.addEventListener("pointerleave", onBubbleLeave);
  bubbleClose.addEventListener("click", onCloseClick);

  function dispose(): void {
    clearDwell();
    cancelShowFrame();
    cancelFade?.();
    cancelFade = null;
    clearSpeechAction();
    unsubscribeLocale();
    bubbleEl.removeEventListener("pointerenter", onBubbleEnter);
    bubbleEl.removeEventListener("pointerleave", onBubbleLeave);
    bubbleClose.removeEventListener("click", onCloseClick);
  }

  return {
    beginSpeech,
    pushSpeech,
    endSpeech,
    finishSpeech,
    hideSpeech,
    showSpeechAction,
    reveal,
    release,
    measure,
    holdForTurn,
    liftAboveInput,
    resetPosition,
    dispose,
  };
}

/** Read the --yui-dwell token (ms). null if absent. */
function readDwellToken(el: HTMLElement): number | null {
  const raw = getComputedStyle(el).getPropertyValue("--yui-dwell").trim();
  if (raw === "") return null;
  const ms = raw.endsWith("ms")
    ? parseFloat(raw)
    : raw.endsWith("s")
      ? parseFloat(raw) * 1000
      : parseFloat(raw);
  return Number.isFinite(ms) ? ms : null;
}
