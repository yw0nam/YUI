/**
 * YUI interaction surfaces — speech bubble · tool-status · text input.
 *
 * Manages the three surfaces as one system (DESIGN.md "The Hearthlight").
 * The API is a **state renderer** — firing ≠ judgment: this controller only
 * *draws* the state the backend decides. Judgment (whether/what to speak) is the
 * backend's; speech triggers come from dispatcher/chat-client.
 * No brain, persona, or mode branching lives here.
 *
 * Currently = mock stage: createSurfaces owns DOM/transitions/state, and real data
 * is fed in by mock.ts (script) or (later) the chat-client SSE calling this API.
 */

import "./surfaces.css";
import { afterFadeOut } from "./fade-out";
import { subscribe as subscribeLocale, t } from "./i18n";
import { downscaleToJpeg } from "./image-resize";
import { renderMarkdownInline } from "./markdown";
import { getToolLabel } from "./tool-labels";

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
  /** Show an inline error (e.g. send failure). */
  showInputError(message: string): void;
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
}

const DEFAULT_DWELL = 5000;
const SPEECH_RENDER_INTERVAL_MS = 50;
// Fallback input bottom (px) before the feet anchor arrives. The starting point
// for the calculation that lifts the bubble above the input when it opens.
const DEFAULT_INPUT_BOTTOM_PX = 48;
// Minimum gap (px) between the bubble bottom and the input top.
const BUBBLE_INPUT_GAP_PX = 12;

export function createSurfaces({ mount, dwellMs }: SurfacesOptions): Surfaces {
  const el = document.createElement("div");
  el.className = "yui-ui";
  el.innerHTML = `
    <div class="yui-tool" role="status" aria-live="polite" hidden>
      <span class="yui-tool__dot" aria-hidden="true"></span>
      <span class="yui-tool__label"></span>
    </div>
    <div class="yui-bubble" hidden>
      <span class="yui-bubble__text"></span><span class="yui-bubble__caret" aria-hidden="true">|</span>
    </div>
    <span class="yui-bubble__sr" role="status" aria-live="polite"></span>
    <form class="yui-input" novalidate hidden>
      <div class="yui-input__tray"></div>
      <div class="yui-input__row">
        <button type="button" class="yui-input__attach" aria-label="${t("aria.attach_image")}">
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
          placeholder="${t("input.placeholder")}"
          aria-label="${t("aria.input_field")}"
        />
        <span class="yui-input__error" role="alert"></span>
        <button class="yui-input__send" type="submit" aria-label="${t("aria.send")}">
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
  // Screen-reader-only announce region — the visual bubble is not live; once speech settles, announce once here.
  const bubbleSr = el.querySelector<HTMLSpanElement>(".yui-bubble__sr")!;
  const formEl = el.querySelector<HTMLFormElement>(".yui-input")!;
  const field = el.querySelector<HTMLInputElement>(".yui-input__field")!;
  const errorEl = el.querySelector<HTMLSpanElement>(".yui-input__error")!;
  const trayEl = el.querySelector<HTMLDivElement>(".yui-input__tray")!;
  const attachBtn = el.querySelector<HTMLButtonElement>(".yui-input__attach")!;
  const picker = el.querySelector<HTMLInputElement>(".yui-input__picker")!;
  const sendBtn = el.querySelector<HTMLButtonElement>(".yui-input__send")!;

  const dwell = dwellMs ?? readDwellToken(el) ?? DEFAULT_DWELL;
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  // ponytail: no count/size cap — add when context-size bites.
  const attachments: string[] = [];
  // Backend processing — the send button becomes stop and submit is blocked.
  let busy = false;
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
  // Input bottom offset (px) — updated by setInputAnchor, used to lift the bubble while the input is open.
  let inputBottomPx = DEFAULT_INPUT_BOTTOM_PX;

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

  // If the user is within this many px of the bottom, treat as pinned for auto-scroll.
  const SCROLL_PIN_SLACK_PX = 8;

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

  // ── speech bubble ──
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
    afterFadeOut(bubbleEl, () => {
      if (!bubbleEl.classList.contains("is-visible")) {
        bubbleEl.hidden = true;
        speechRaw = "";
        bubbleText.replaceChildren();
      }
    });
  }

  // While the input is open, lift the bubble above it to prevent overlap.
  // Bubble bottom = input bottom + input height + gap. Even if the feet anchor changes each frame,
  // setInputAnchor re-calls this to update just the value (class toggle happens once).
  function liftBubbleAboveInput(): void {
    const lift = inputBottomPx + formEl.offsetHeight + BUBBLE_INPUT_GAP_PX;
    bubbleEl.style.setProperty("--yui-bubble-bottom", `${lift}px`);
    bubbleEl.classList.add("is-above-input");
  }

  function resetBubblePosition(): void {
    bubbleEl.classList.remove("is-above-input");
    bubbleEl.style.removeProperty("--yui-bubble-bottom");
  }

  // ── tool-status ──
  const TOOL_DONE_HOLD_MS = 500;
  let toolHideTimer: ReturnType<typeof setTimeout> | null = null;

  function clearToolTimer(): void {
    if (toolHideTimer !== null) {
      clearTimeout(toolHideTimer);
      toolHideTimer = null;
    }
  }

  function showTool(toolId: string): void {
    clearToolTimer();
    toolLabel.textContent = getToolLabel(toolId);
    toolEl.dataset.state = "running";
    toolEl.hidden = false;
    requestAnimationFrame(() => toolEl.classList.add("is-visible"));
  }

  function finishTool(): void {
    if (toolEl.hidden) return;
    clearToolTimer();
    toolEl.dataset.state = "done";
    toolHideTimer = setTimeout(() => {
      toolHideTimer = null;
      hideTool();
    }, TOOL_DONE_HOLD_MS);
  }

  function hideTool(): void {
    clearToolTimer();
    toolEl.classList.remove("is-visible");
    afterFadeOut(toolEl, () => {
      if (!toolEl.classList.contains("is-visible")) toolEl.hidden = true;
    });
  }

  // ── text input ──
  function summonInput(): void {
    formEl.hidden = false;
    formEl.classList.remove("is-error", "is-pending");
    errorEl.textContent = "";
    liftBubbleAboveInput();
    requestAnimationFrame(() => {
      formEl.classList.add("is-open");
      field.focus();
    });
  }

  function dismissInput(): void {
    formEl.classList.remove("is-open");
    field.blur();
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      formEl.removeEventListener("transitionend", onEnd);
      if (!formEl.classList.contains("is-open")) {
        formEl.hidden = true;
        field.value = "";
        clearAttachments();
        formEl.classList.remove("is-error", "is-pending");
        errorEl.textContent = "";
        resetBubblePosition();
      }
    };
    formEl.addEventListener("transitionend", onEnd);
  }

  function isInputOpen(): boolean {
    return formEl.classList.contains("is-open");
  }

  function showInputError(message: string): void {
    errorEl.textContent = message;
    formEl.classList.add("is-error");
    formEl.classList.remove("is-pending");
  }

  function onSubmit(cb: (text: string, images: string[]) => void): void {
    submitHandlers.push(cb);
  }

  function clearAttachments(): void {
    attachments.length = 0;
    trayEl.replaceChildren();
  }

  function addFiles(files: FileList | File[]): void {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      void downscaleToJpeg(file).then((url) => {
        attachments.push(url);
        addChip(url);
      });
    }
  }

  function addChip(dataUrl: string): void {
    const chip = document.createElement("div");
    chip.className = "yui-chip";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = ""; // Decorative thumbnail — the chip's × button conveys the attachment's presence.
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "yui-chip__remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", t("aria.remove_attachment"));
    remove.addEventListener("click", () => {
      const idx = Array.from(trayEl.children).indexOf(chip);
      if (idx !== -1) attachments.splice(idx, 1);
      chip.remove();
    });
    chip.append(img, remove);
    trayEl.append(chip);
  }

  function onStop(cb: () => void): void {
    stopHandlers.push(cb);
  }

  // When busy: swap send→stop icon + amber, dim the field, block submit.
  function setBusy(value: boolean): void {
    busy = value;
    formEl.classList.toggle("is-running", value);
    sendBtn.setAttribute("aria-label", value ? t("aria.stop") : t("aria.send"));
  }

  // surfaces isn't remounted on locale change, so update the static labels directly.
  function applyLocaleLabels(): void {
    attachBtn.setAttribute("aria-label", t("aria.attach_image"));
    field.placeholder = t("input.placeholder");
    field.setAttribute("aria-label", t("aria.input_field"));
    sendBtn.setAttribute("aria-label", busy ? t("aria.stop") : t("aria.send"));
  }
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  function setInputEnabled(enabled: boolean): void {
    field.disabled = !enabled;
    formEl.classList.toggle("is-pending", !enabled);
  }

  function setInputAnchor(bottomPx: number | null): void {
    if (bottomPx === null) formEl.style.removeProperty("--yui-input-bottom");
    else formEl.style.setProperty("--yui-input-bottom", `${bottomPx}px`);
    inputBottomPx = bottomPx ?? DEFAULT_INPUT_BOTTOM_PX;
    // If the input is up (summoned), update the bubble lift to match the feet anchor change.
    if (!formEl.hidden) liftBubbleAboveInput();
  }

  function handleSubmit(e: Event): void {
    e.preventDefault();
    if (busy) return; // While processing, Enter/submit is a no-op — stopping only via a button click
    const text = field.value.trim();
    if (text === "" && attachments.length === 0) return;
    formEl.classList.remove("is-error");
    errorEl.textContent = "";
    const images = attachments.slice();
    for (const cb of submitHandlers) cb(text, images);
    clearAttachments();
  }

  // Button click while busy = stop (intercepts submit). When idle, passes through as type=submit.
  function handleSendClick(e: Event): void {
    if (!busy) return;
    e.preventDefault();
    for (const cb of stopHandlers) cb();
  }

  function handleFieldKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      dismissInput();
    }
  }
  // Clear the error once the user types again
  function clearErrorOnInput(): void {
    if (formEl.classList.contains("is-error")) {
      formEl.classList.remove("is-error");
      errorEl.textContent = "";
    }
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

  function onAttachClick(): void {
    picker.click();
  }
  function onPickerChange(): void {
    if (picker.files) addFiles(picker.files);
    picker.value = "";
  }
  function onFieldPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    // For a mixed text+image paste, don't block the default so the text is preserved.
    // Only block for image-only pastes so a filename doesn't leak into the field.
    if (!e.clipboardData?.getData("text")) e.preventDefault();
    addFiles(files);
  }
  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    formEl.classList.add("is-dragover");
  }
  function onDragLeave(e: DragEvent): void {
    // dragleave also fires when entering a child element, so clear only when actually leaving the form.
    if (!formEl.contains(e.relatedTarget as Node)) formEl.classList.remove("is-dragover");
  }
  function onDrop(e: DragEvent): void {
    e.preventDefault();
    formEl.classList.remove("is-dragover");
    if (e.dataTransfer) addFiles(e.dataTransfer.files);
  }

  formEl.addEventListener("submit", handleSubmit);
  sendBtn.addEventListener("click", handleSendClick);
  field.addEventListener("keydown", handleFieldKey);
  field.addEventListener("input", clearErrorOnInput);
  field.addEventListener("paste", onFieldPaste);
  attachBtn.addEventListener("click", onAttachClick);
  picker.addEventListener("change", onPickerChange);
  formEl.addEventListener("dragover", onDragOver);
  formEl.addEventListener("dragleave", onDragLeave);
  formEl.addEventListener("drop", onDrop);
  bubbleEl.addEventListener("pointerenter", onBubbleEnter);
  bubbleEl.addEventListener("pointerleave", onBubbleLeave);

  function dispose(): void {
    clearDwell();
    unsubscribeLocale();
    formEl.removeEventListener("submit", handleSubmit);
    sendBtn.removeEventListener("click", handleSendClick);
    field.removeEventListener("keydown", handleFieldKey);
    field.removeEventListener("input", clearErrorOnInput);
    field.removeEventListener("paste", onFieldPaste);
    attachBtn.removeEventListener("click", onAttachClick);
    picker.removeEventListener("change", onPickerChange);
    formEl.removeEventListener("dragover", onDragOver);
    formEl.removeEventListener("dragleave", onDragLeave);
    formEl.removeEventListener("drop", onDrop);
    bubbleEl.removeEventListener("pointerenter", onBubbleEnter);
    bubbleEl.removeEventListener("pointerleave", onBubbleLeave);
    submitHandlers.length = 0;
    stopHandlers.length = 0;
    el.remove();
  }

  return {
    el,
    beginSpeech,
    pushSpeech,
    endSpeech,
    finishSpeech,
    hideSpeech,
    showTool,
    finishTool,
    hideTool,
    summonInput,
    dismissInput,
    isInputOpen,
    onSubmit,
    onStop,
    setBusy,
    showInputError,
    setInputEnabled,
    setInputAnchor,
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
