/**
 * YUI interaction surfaces — speech bubble · text input, forwarding tool status.
 *
 * Mounts the two surfaces as one system (DESIGN.md "The Hearthlight") and
 * composes their independent controllers behind one API. The API is a **state
 * renderer** — firing ≠ judgment: it only *draws* the state the backend decides.
 * Judgment (whether/what to speak) is the backend's; speech triggers come from
 * dispatcher/chat-client. No brain, persona, or mode branching lives here.
 *
 * createSurfaces owns DOM/transitions/state; production data is fed in by
 * chat-client and speech-playback calling this API, and the dev-only mock
 * driver (mock.ts) drives it the same way for the screenshot verification loop.
 */

import "./surfaces.css";
import type { AttachmentLimits } from "../../config/load";
import type { UserQuote } from "../../io/bridge/message-bridge";
import type { InputErrorAction } from "../../io/bridge/message-remote";
import type { ToolStatus } from "../chips/status-pill";
import { subscribe as subscribeLocale, t } from "../i18n";
import type { MicPort } from "../input/action-button";
import { createTextInput } from "../input/text-input";
import { createReasoningDisclosure, type ReasoningSource } from "../message/reasoning-disclosure";
import { createSpeechBubble } from "../message/speech-bubble";
import { createUserQuote } from "../message/user-quote";

// Arrows-out: moves speech into the message window. Stroke width comes from each button's CSS.
const POP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"
     stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8"/></svg>`;

export interface Surfaces {
  /** overlay root (.yui-ui) */
  readonly el: HTMLElement;

  // ── speech bubble (output) ──
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
  /** A turn the user started was admitted: the bubble opens with the message quoted on its first line and holds through the turn. */
  quoteUser(quote: UserQuote): void;
  /** The quoted turn is over: the line stays and the bubble takes its dwell, or hides when it shows nothing else. */
  settleQuote(): void;
  /** The quoted turn ended before any reply: the line goes and the bubble hides when it shows nothing else. */
  clearQuote(): void;

  // ── tool status (observing backend tools), forwarded to the ToolStatus the surfaces were given ──
  showTool(toolId: string): void;
  finishTool(): void;
  hideTool(): void;

  // ── text input ──
  /** Hotkey summon — slide up + focus. */
  summonInput(): void;
  /** Close the input. */
  dismissInput(): void;
  /** Whether the input is open. */
  isInputOpen(): boolean;
  /** Register a submit callback. text is trimmed (empty string when sending images only); images is an array of data URLs. */
  onSubmit(cb: (text: string, images: string[]) => void): void;
  /** Register a stop callback. Fires only when the send button is explicitly pressed while busy. */
  onStop(cb: () => void): void;
  /**
   * Toggle processing state. When busy, the send button becomes stop (is-running + amber),
   * and Enter/submit becomes a no-op. Stopping fires only via a button click.
   */
  setBusy(busy: boolean): void;
  /** Show an inline error (e.g. send failure), optionally with a button that fixes it in place. */
  showInputError(message: string, action?: InputErrorAction): void;
  /** Apply the configured attach-time caps (configs/guardrails.json → attachments). */
  setAttachmentLimits(limits: AttachmentLimits): void;
  /** Puts a sent message back into an open, empty composer, attachments included; a closed composer or one holding a draft is left alone. */
  restoreInput(text: string, images: string[]): void;
  /**
   * Set the input's bottom offset (px) for tracking the character's feet. Overrides
   * the CSS `bottom: var(--yui-input-bottom, 4%)` in pixels. null clears the var,
   * returning to the default 4%. Does not touch width or the slide-up reveal.
   */
  setInputAnchor(bottomPx: number | null): void;

  dispose(): void;
}

interface SurfacesOptions {
  mount: HTMLElement;
  /** Where tool status is drawn; the surfaces render no tool tell of their own. */
  tool: ToolStatus;
  /** dwell (config value) override. Default = --yui-dwell token. */
  dwellMs?: number;
  /** When it returns true, speech holds until the bubble's close button (or new speech) dismisses it. */
  keepBubbleUntilDismissed?: () => boolean;
  /** Called when a pop-out button — on the bubble or on the input row — is pressed; without it both are hidden. */
  onPop?: () => void;
  /** Called whenever the input's open state settles. */
  onInputOpenChange?: (open: boolean) => void;
  /** The backend's reasoning, folded at the top of the bubble under the quoted line. */
  reasoning?: ReasoningSource;
  /** The input stays open from construction; the send button sends and Enter is a newline. */
  persistentInput?: boolean;
  /** The mic the action button becomes while the composer is empty and no turn runs; without it the button only sends and stops. */
  mic?: MicPort;
}

export function createSurfaces({
  mount,
  tool,
  dwellMs,
  keepBubbleUntilDismissed,
  onPop,
  onInputOpenChange,
  reasoning,
  persistentInput,
  mic,
}: SurfacesOptions): Surfaces {
  const el = document.createElement("div");
  el.className = "yui-ui";
  el.innerHTML = `
    <div class="yui-bubble" hidden>
      <div class="yui-bubble__tools">
        <button class="yui-bubble__pop" type="button">${POP_ICON}</button>
        <button class="yui-bubble__close" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>
      <div class="yui-bubble__box"><div class="yui-bubble__quote" hidden></div><span class="yui-bubble__text"></span><span class="yui-bubble__caret" aria-hidden="true">|</span></div>
    </div>
    <span class="yui-bubble__sr" role="status" aria-live="polite"></span>
    <form class="yui-input" novalidate hidden>
      <div class="yui-input__tray"></div>
      <div class="yui-input__row">
        <button type="button" class="yui-input__btn yui-input__attach">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          class="yui-input__field"
          rows="1"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        ></textarea>
        <span class="yui-input__error" role="alert"></span>
        <button type="button" class="yui-input__btn yui-input__pop">${POP_ICON}</button>
        <button class="yui-input__btn yui-input__send" type="submit">
          <span class="icon-mic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>
          </span>
          <span class="icon-send" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
          </span>
          <span class="icon-stop" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>
          </span>
        </button>
        <input type="file" class="yui-input__picker" accept="image/*" multiple hidden />
      </div>
    </form>
  `;
  mount.appendChild(el);

  const bubbleEl = el.querySelector<HTMLDivElement>(".yui-bubble")!;
  const bubbleBox = el.querySelector<HTMLDivElement>(".yui-bubble__box")!;
  const bubbleQuote = el.querySelector<HTMLDivElement>(".yui-bubble__quote")!;
  const bubbleText = el.querySelector<HTMLSpanElement>(".yui-bubble__text")!;
  const bubbleSr = el.querySelector<HTMLSpanElement>(".yui-bubble__sr")!;
  const bubbleClose = el.querySelector<HTMLButtonElement>(".yui-bubble__close")!;
  const bubblePop = el.querySelector<HTMLButtonElement>(".yui-bubble__pop")!;
  const inputPop = el.querySelector<HTMLButtonElement>(".yui-input__pop")!;
  const formEl = el.querySelector<HTMLFormElement>(".yui-input")!;
  const field = el.querySelector<HTMLTextAreaElement>(".yui-input__field")!;
  const errorEl = el.querySelector<HTMLSpanElement>(".yui-input__error")!;
  const trayEl = el.querySelector<HTMLDivElement>(".yui-input__tray")!;
  const attachBtn = el.querySelector<HTMLButtonElement>(".yui-input__attach")!;
  const picker = el.querySelector<HTMLInputElement>(".yui-input__picker")!;
  const sendBtn = el.querySelector<HTMLButtonElement>(".yui-input__send")!;

  const bubble = createSpeechBubble(
    { root: el, bubbleEl, bubbleBox, bubbleQuote, bubbleText, bubbleSr, bubbleClose },
    dwellMs,
    keepBubbleUntilDismissed,
  );
  // A reasoning cycle's first delta shows the bubble and holds off its fade until the cycle ends; the end hands
  // a bubble with no speech in flight to the dwell, or hides it when nothing is left to show.
  const think = reasoning
    ? createReasoningDisclosure({ before: bubbleText, source: reasoning, bubble })
    : null;
  const quote = createUserQuote({ el: bubbleQuote, bubble });
  const input = createTextInput(
    { formEl, field, errorEl, trayEl, attachBtn, picker, sendBtn },
    { liftAboveInput: bubble.liftAboveInput, resetPosition: bubble.resetPosition },
    onInputOpenChange,
    { persistentInput, mic },
  );

  const popButtons = [bubblePop, inputPop];
  for (const button of popButtons) button.hidden = onPop === undefined;

  // Surfaces aren't remounted on locale change, so the labels are (re)applied here.
  function applyLocaleLabels(): void {
    for (const button of popButtons) {
      button.setAttribute("aria-label", t("aria.pop_message"));
      button.setAttribute("title", t("aria.pop_message"));
    }
  }
  applyLocaleLabels();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  const onPopClick = (): void => onPop?.();
  for (const button of popButtons) button.addEventListener("click", onPopClick);

  function dispose(): void {
    unsubscribeLocale();
    for (const button of popButtons) button.removeEventListener("click", onPopClick);
    think?.dispose();
    quote.dispose();
    bubble.dispose();
    input.dispose();
    el.remove();
  }

  return {
    el,
    beginSpeech: bubble.beginSpeech,
    pushSpeech: bubble.pushSpeech,
    endSpeech: bubble.endSpeech,
    finishSpeech: bubble.finishSpeech,
    hideSpeech: bubble.hideSpeech,
    quoteUser: quote.show,
    settleQuote: quote.settle,
    clearQuote: quote.clear,
    showTool: tool.showTool,
    finishTool: tool.finishTool,
    hideTool: tool.hideTool,
    summonInput: input.summonInput,
    dismissInput: input.dismissInput,
    isInputOpen: input.isInputOpen,
    onSubmit: input.onSubmit,
    onStop: input.onStop,
    setBusy: input.setBusy,
    showInputError: input.showInputError,
    setAttachmentLimits: input.setAttachmentLimits,
    restoreInput: input.restoreInput,
    setInputAnchor: input.setInputAnchor,
    dispose,
  };
}
