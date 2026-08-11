/**
 * Speech bubble — dwell/scroll/markdown/aria for streamed backend speech.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the text handed to it.
 * Judgment (whether/what to speak) is the backend's.
 */

import { afterFadeOut } from "./fade-out";
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
  /** Lift the bubble above the input by totalOffsetPx (input bottom + input height + gap). */
  liftAboveInput(totalOffsetPx: number): void;
  /** Restore the bubble's default (input-closed) position. */
  resetPosition(): void;
  dispose(): void;
}

export interface SpeechBubbleElements {
  /** overlay root (.yui-ui) — read for the --yui-dwell CSS token. */
  root: HTMLElement;
  bubbleEl: HTMLElement;
  bubbleText: HTMLElement;
  /** Screen-reader-only announce region — the visual bubble is not live; once speech settles, announce once here. */
  bubbleSr: HTMLElement;
}

const DEFAULT_DWELL = 5000;
const SPEECH_RENDER_INTERVAL_MS = 50;
// If the user is within this many px of the bottom, treat as pinned for auto-scroll.
const SCROLL_PIN_SLACK_PX = 8;

export function createSpeechBubble(
  { root, bubbleEl, bubbleText, bubbleSr }: SpeechBubbleElements,
  dwellMs?: number,
): SpeechBubble {
  const dwell = dwellMs ?? readDwellToken(root) ?? DEFAULT_DWELL;
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
  let cancelFade: (() => void) | null = null;

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

  function isPinnedToEnd(): boolean {
    return (
      bubbleEl.scrollHeight - bubbleEl.scrollTop - bubbleEl.clientHeight <= SCROLL_PIN_SLACK_PX
    );
  }

  // Scroll a height-capped bubble to the end so the latest line stays visible (keeps position if pin=false).
  // Only toggle is-scrollable on overflow so the top fade applies (short speech doesn't clip its first line).
  function scrollBubbleToEnd(pin = true): void {
    if (pin) bubbleEl.scrollTop = bubbleEl.scrollHeight;
    bubbleEl.classList.toggle("is-scrollable", bubbleEl.scrollHeight > bubbleEl.clientHeight);
  }

  function beginSpeech(): void {
    clearDwell();
    deferred = false;
    speechRaw = "";
    lastRenderAt = Number.NEGATIVE_INFINITY;
    bubbleText.replaceChildren();
    bubbleSr.textContent = "";
    bubbleEl.hidden = false;
    bubbleEl.classList.add("is-streaming");
    // Arm the transition on the next frame (won't animate in the same frame right after clearing hidden)
    requestAnimationFrame(() => bubbleEl.classList.add("is-visible"));
  }

  function pushSpeech(delta: string): void {
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
    dwellArmed = true;
    armDwell();
  }

  function finishSpeech(): void {
    if (!deferred) return;
    deferred = false;
    if (bubbleEl.hidden) return;
    dwellArmed = true;
    armDwell();
  }

  function hideSpeech(): void {
    clearDwell();
    dwellArmed = false;
    deferred = false;
    lastRenderAt = Number.NEGATIVE_INFINITY;
    bubbleEl.classList.remove("is-visible", "is-streaming");
    cancelFade?.();
    cancelFade = afterFadeOut(bubbleEl, () => {
      cancelFade = null;
      if (!bubbleEl.classList.contains("is-visible")) {
        bubbleEl.hidden = true;
        speechRaw = "";
        bubbleText.replaceChildren();
      }
    });
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

  bubbleEl.addEventListener("pointerenter", onBubbleEnter);
  bubbleEl.addEventListener("pointerleave", onBubbleLeave);

  function dispose(): void {
    clearDwell();
    cancelFade?.();
    cancelFade = null;
    bubbleEl.removeEventListener("pointerenter", onBubbleEnter);
    bubbleEl.removeEventListener("pointerleave", onBubbleLeave);
  }

  return {
    beginSpeech,
    pushSpeech,
    endSpeech,
    finishSpeech,
    hideSpeech,
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
