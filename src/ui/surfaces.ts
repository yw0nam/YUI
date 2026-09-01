/**
 * YUI interaction surfaces — speech bubble · tool-status · text input.
 *
 * Mounts the three surfaces as one system (DESIGN.md "The Hearthlight") and
 * composes their independent controllers behind one API. The API is a **state
 * renderer** — firing ≠ judgment: it only *draws* the state the backend decides.
 * Judgment (whether/what to speak) is the backend's; speech triggers come from
 * dispatcher/chat-client. No brain, persona, or mode branching lives here.
 *
 * Currently = mock stage: createSurfaces owns DOM/transitions/state, and real data
 * is fed in by mock.ts (script) or (later) the chat-client SSE calling this API.
 */

import "./surfaces.css";
import type { AttachmentLimits } from "../config";
import { isTauri } from "../io/tauri-env";
import { t } from "./i18n";
import { createSpeechBubble } from "./speech-bubble";
import { createTextInput, type InputErrorAction } from "./text-input";
import { createToolStatus } from "./tool-status";

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

  // ── tool-status (observing backend tools) ──
  /** Show a running chip for tool_id (label from tool-labels lookup, humanized if unmapped). */
  showTool(toolId: string): void;
  /** Transition the running chip to done (check), then auto-dismiss shortly after. Ignored if no chip. */
  finishTool(): void;
  /** Hide the chip immediately. */
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
  /** Toggle the input disabled (e.g. while processing). When disabled, field disabled + pending dimming. */
  setInputEnabled(enabled: boolean): void;
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
  /** dwell (config value) override. Default = --yui-dwell token. */
  dwellMs?: number;
  /** When it returns true, speech holds until the bubble's close button (or new speech) dismisses it. */
  keepBubbleUntilDismissed?: () => boolean;
  /** Called when the pop-out button on the bubble is pressed. */
  onPop?: () => void;
  /** Called whenever the input's open state settles. */
  onInputOpenChange?: (open: boolean) => void;
}

export function createSurfaces({
  mount,
  dwellMs,
  keepBubbleUntilDismissed,
  onPop,
  onInputOpenChange,
}: SurfacesOptions): Surfaces {
  const el = document.createElement("div");
  el.className = "yui-ui";
  el.innerHTML = `
    <div class="yui-tool" role="status" aria-live="polite" hidden>
      <span class="yui-tool__dot" aria-hidden="true"></span>
      <span class="yui-tool__label"></span>
    </div>
    <div class="yui-bubble" hidden>
      <span class="yui-bubble__text"></span><span class="yui-bubble__caret" aria-hidden="true">|</span>
      <button class="yui-bubble__pop" type="button">⤢</button>
      <button class="yui-bubble__close" type="button">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <span class="yui-bubble__sr" role="status" aria-live="polite"></span>
    <form class="yui-input" novalidate hidden>
      <div class="yui-input__tray"></div>
      <div class="yui-input__row">
        <button type="button" class="yui-input__attach">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          class="yui-input__field"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <span class="yui-input__error" role="alert"></span>
        <button class="yui-input__send" type="submit">
          <span class="icon-send" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <line x1="8" y1="13" x2="8" y2="3"/>
              <polyline points="4,7 8,3 12,7"/>
            </svg>
          </span>
          <span class="icon-stop" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <rect x="4" y="4" width="8" height="8" rx="1.5"/>
            </svg>
          </span>
        </button>
        <input type="file" class="yui-input__picker" accept="image/*" multiple hidden />
      </div>
    </form>
  `;
  mount.appendChild(el);

  const toolEl = el.querySelector<HTMLDivElement>(".yui-tool")!;
  const toolLabel = el.querySelector<HTMLSpanElement>(".yui-tool__label")!;
  const bubbleEl = el.querySelector<HTMLDivElement>(".yui-bubble")!;
  const bubbleText = el.querySelector<HTMLSpanElement>(".yui-bubble__text")!;
  const bubbleSr = el.querySelector<HTMLSpanElement>(".yui-bubble__sr")!;
  const bubbleClose = el.querySelector<HTMLButtonElement>(".yui-bubble__close")!;
  const bubblePop = el.querySelector<HTMLButtonElement>(".yui-bubble__pop")!;
  const formEl = el.querySelector<HTMLFormElement>(".yui-input")!;
  const field = el.querySelector<HTMLInputElement>(".yui-input__field")!;
  const errorEl = el.querySelector<HTMLSpanElement>(".yui-input__error")!;
  const trayEl = el.querySelector<HTMLDivElement>(".yui-input__tray")!;
  const attachBtn = el.querySelector<HTMLButtonElement>(".yui-input__attach")!;
  const picker = el.querySelector<HTMLInputElement>(".yui-input__picker")!;
  const sendBtn = el.querySelector<HTMLButtonElement>(".yui-input__send")!;

  const bubble = createSpeechBubble(
    { root: el, bubbleEl, bubbleText, bubbleSr, bubbleClose },
    dwellMs,
    keepBubbleUntilDismissed,
  );
  const tool = createToolStatus({ toolEl, toolLabel });
  const input = createTextInput(
    { formEl, field, errorEl, trayEl, attachBtn, picker, sendBtn },
    { liftAboveInput: bubble.liftAboveInput, resetPosition: bubble.resetPosition },
    onInputOpenChange,
  );

  // Without a second OS window there is nowhere to pop into, so the browser build hides it.
  bubblePop.hidden = !isTauri();
  bubblePop.setAttribute("aria-label", t("aria.pop_message"));
  bubblePop.setAttribute("title", t("aria.pop_message"));
  const onPopClick = (): void => onPop?.();
  bubblePop.addEventListener("click", onPopClick);

  function dispose(): void {
    bubblePop.removeEventListener("click", onPopClick);
    bubble.dispose();
    tool.dispose();
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
    setInputEnabled: input.setInputEnabled,
    setInputAnchor: input.setInputAnchor,
    dispose,
  };
}
