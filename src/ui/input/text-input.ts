/**
 * Text input — submit/busy/error/anchor for the composer surface.
 *
 * Pure renderer — firing ≠ judgment: this only collects and forwards what the
 * user typed/attached. No brain, persona, or mode branching lives here.
 */

import type { AttachmentLimits } from "../../config/validators/guardrails";
import type { AttachedThread } from "../../contract";
import type { InputErrorOffer } from "../../io/bridge/message/message-remote";
import { subscribe as subscribeLocale, t } from "../i18n";
import { type ActionButton, createActionButton } from "./action-button";
import { downscaleToJpeg } from "./image-resize";

export type SubmitInterception = false | "accepted" | "refused";

export interface TextInput {
  interceptSubmit(fn: (text: string, images: string[]) => SubmitInterception): void;
  /** Hotkey summon — slide up + focus; a no-op while the input is already open. */
  summonInput(): void;
  /** Close the input. */
  dismissInput(): void;
  /** Whether the input is open. */
  isInputOpen(): boolean;
  /** Register a submit callback. text is trimmed (empty string when sending attachments only); images is an array of data URLs; threads are the Thread chips shown. */
  onSubmit(cb: (text: string, images: string[], threads: AttachedThread[]) => void): void;
  /** Register a stop callback. Fires only when the send button is explicitly pressed while busy. */
  onStop(cb: () => void): void;
  /**
   * Toggle processing state. When busy, the send button becomes stop (is-running + amber),
   * and Enter/submit becomes a no-op. Stopping fires only via a button click.
   */
  setBusy(busy: boolean): void;
  /** Show an inline error (e.g. send failure), optionally with a button that fixes it in place or resends the draft. */
  showInputError(message: string, action?: InputErrorOffer): void;
  /** Apply the configured attach-time caps (configs/guardrails.json → attachments). */
  setAttachmentLimits(limits: AttachmentLimits): void;
  /** Puts a sent message back into an open, empty composer, attachments included; a closed composer or one holding a draft is left alone. */
  restoreInput(text: string, images: string[]): void;
  /** Draws the attached Threads as chips in their own row above the field. */
  setThreads(threads: AttachedThread[]): void;
  /** Register a callback for a Thread chip's ×. */
  onThreadRemove(cb: (thread: AttachedThread) => void): void;
  /**
   * Set the input's bottom offset (px) for tracking the character's feet. Overrides
   * the CSS `bottom: var(--yui-input-bottom, 4%)` in pixels. null clears the var,
   * returning to the default 4%. Does not touch width or the slide-up reveal.
   */
  setInputAnchor(bottomPx: number | null): void;
  dispose(): void;
}

interface TextInputElements {
  formEl: HTMLFormElement;
  field: HTMLTextAreaElement;
  errorEl: HTMLElement;
  trayEl: HTMLElement;
  attachBtn: HTMLButtonElement;
  picker: HTMLInputElement;
  sendBtn: HTMLButtonElement;
}

/** The speech bubble's positioning hooks — the input lifts the bubble above itself while open. */
interface TextInputBubbleAnchor {
  liftAboveInput(totalOffsetPx: number): void;
  resetPosition(): void;
}

// Fallback input bottom (px) before the feet anchor arrives. The starting point
// for the calculation that lifts the bubble above the input when it opens.
const DEFAULT_INPUT_BOTTOM_PX = 48;
// Minimum gap (px) between the bubble bottom and the input top.
const BUBBLE_INPUT_GAP_PX = 12;

const REMOVE_ICON =
  `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
  `<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
  `</svg>`;

export function createTextInput(
  { formEl, field, errorEl, trayEl, attachBtn, picker, sendBtn }: TextInputElements,
  bubble: TextInputBubbleAnchor,
  onOpenChange?: (open: boolean) => void,
): TextInput {
  const submitHandlers: Array<(text: string, images: string[], threads: AttachedThread[]) => void> =
    [];
  const stopHandlers: Array<() => void> = [];
  const threadRemoveHandlers: Array<(thread: AttachedThread) => void> = [];
  let threads: AttachedThread[] = [];
  const threadsEl = document.createElement("div");
  threadsEl.className = "yui-input__threads";
  threadsEl.hidden = true;
  trayEl.before(threadsEl);
  let submitInterceptor: ((text: string, images: string[]) => SubmitInterception) | undefined;
  const attachments: string[] = [];
  // Accepted but still being read into a data URL — counts against max_count so a
  // single multi-file drop cannot slip past the cap.
  let inFlight = 0;
  // Bumped by clearAttachments — reads started for an earlier turn are discarded.
  let epoch = 0;
  // Caps arrive from configs/guardrails.json via setAttachmentLimits; null until they do.
  let limits: AttachmentLimits | null = null;
  // Backend processing — the send button becomes stop and submit is blocked.
  let busy = false;
  // The standing error's Retry button; null when it offers none.
  let retryButton: HTMLButtonElement | null = null;
  // The error line's condition text, which typing over a Retry offer empties.
  let conditionText: Text | null = null;
  // Input bottom offset (px) — updated by setInputAnchor, used to lift the bubble while the input is open.
  let inputBottomPx = DEFAULT_INPUT_BOTTOM_PX;
  const actionButton: ActionButton = createActionButton({
    button: sendBtn,
    busy: () => busy,
    onStop: () => {
      for (const cb of stopHandlers) cb();
    },
  });

  // While the input is open, lift the bubble above it to prevent overlap.
  // Bubble bottom = input bottom + input height + gap. Even if the feet anchor changes each frame,
  // setInputAnchor re-calls this to update just the value (class toggle happens once).
  function liftBubbleAboveInput(): void {
    bubble.liftAboveInput(inputBottomPx + formEl.offsetHeight + BUBBLE_INPUT_GAP_PX);
  }

  // Auto-grow the field with its content; the bubble rides above the taller input.
  function fitField(): void {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
    if (!formEl.hidden) liftBubbleAboveInput();
  }

  function summonInput(): void {
    // Idempotent: a re-summon on an open input must not reset the error state or replay the reveal.
    if (isInputOpen()) return;
    formEl.hidden = false;
    formEl.classList.remove("is-error");
    errorEl.textContent = "";
    fitField();
    requestAnimationFrame(() => {
      formEl.classList.add("is-open");
      field.focus();
    });
    onOpenChange?.(true);
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
        // Measuring is 0px while hidden — summon refits.
        field.style.height = "";
        clearAttachments();
        formEl.classList.remove("is-error");
        errorEl.textContent = "";
        bubble.resetPosition();
        onOpenChange?.(false);
      }
    };
    formEl.addEventListener("transitionend", onEnd);
  }

  function isInputOpen(): boolean {
    return formEl.classList.contains("is-open");
  }

  function clearInputError(): void {
    retryButton = null;
    conditionText = null;
    formEl.classList.remove("is-error");
    errorEl.textContent = "";
    // The row loses its error line — re-lift the bubble.
    fitField();
  }

  function hasDraft(): boolean {
    return field.value.trim() !== "" || attachments.length > 0 || threads.length > 0;
  }

  function showInputError(message: string, action?: InputErrorOffer): void {
    retryButton = null;
    // Shown first — the alert only announces content inserted while it is in the tree.
    formEl.classList.add("is-error");
    errorEl.textContent = message;
    conditionText = errorEl.firstChild as Text | null;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yui-input__error-action";
      if (action === "retry") {
        button.textContent = t("input.action_retry");
        button.hidden = !hasDraft();
        button.addEventListener("click", submitCurrent);
        retryButton = button;
      } else {
        button.textContent = action.label;
        button.addEventListener("click", action.onClick);
      }
      // Space first — the alert announces message and label as one string otherwise.
      errorEl.append(" ", button);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "yui-input__error-dismiss";
    dismiss.setAttribute("aria-label", t("aria.dismiss_error"));
    // Icon-only — a text glyph would land inside the alert's announced string.
    dismiss.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
      `<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
      `</svg>`;
    dismiss.addEventListener("click", () => {
      clearInputError();
      field.focus();
    });
    errorEl.append(dismiss);
    // The row gains its error line — re-lift the bubble.
    fitField();
  }

  function onSubmit(cb: (text: string, images: string[], threads: AttachedThread[]) => void): void {
    submitHandlers.push(cb);
  }

  function setThreads(next: AttachedThread[]): void {
    threads = next;
    threadsEl.replaceChildren(
      ...next.map((thread) => {
        const chip = document.createElement("span");
        chip.className = "yui-input__thread";
        const label = document.createElement("span");
        label.textContent = t("input.thread_chip", { title: thread.title });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.innerHTML = REMOVE_ICON;
        remove.setAttribute("aria-label", t("aria.remove_thread", { title: thread.title }));
        remove.addEventListener("click", () => {
          for (const cb of threadRemoveHandlers) cb(thread);
        });
        chip.append(label, remove);
        return chip;
      }),
    );
    threadsEl.hidden = next.length === 0;
    if (!formEl.hidden) liftBubbleAboveInput();
  }

  /** The attach affordance stays off while there is nothing to validate a picked image against. */
  function applyAttachEnabled(): void {
    attachBtn.disabled = limits === null;
  }
  applyAttachEnabled();

  function setAttachmentLimits(next: AttachmentLimits): void {
    limits = next;
    applyAttachEnabled();
  }

  function clearAttachments(): void {
    attachments.length = 0;
    inFlight = 0;
    epoch++;
    trayEl.replaceChildren();
    if (!formEl.hidden) liftBubbleAboveInput();
  }

  function addFiles(files: FileList | File[]): void {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    if (!limits) {
      showInputError(t("input.attach_not_ready"));
      return;
    }
    for (const file of images) {
      if (attachments.length + inFlight >= limits.max_count) {
        showInputError(t("input.attach_too_many", { max: limits.max_count }));
        return;
      }
      if (file.size > limits.max_image_bytes) {
        showInputError(
          t("input.attach_too_large", {
            max: Math.round((limits.max_image_bytes / 1024 / 1024) * 10) / 10,
          }),
        );
        continue;
      }
      inFlight++;
      const batch = epoch;
      void downscaleToJpeg(file)
        .then((url) => {
          if (batch !== epoch) return;
          attachments.push(url);
          addChip(url);
        })
        .catch(() => {
          if (batch !== epoch) return;
          showInputError(t("input.attach_failed"));
        })
        .finally(() => {
          if (batch !== epoch) return;
          inFlight--;
        });
    }
  }

  function addChip(dataUrl: string): void {
    const chip = document.createElement("div");
    chip.className = "yui-chip";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = ""; // Decorative thumbnail — the chip's remove button conveys the attachment's presence.
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "yui-chip__remove";
    remove.innerHTML = REMOVE_ICON;
    remove.setAttribute("aria-label", t("aria.remove_attachment"));
    remove.addEventListener("click", () => {
      const idx = Array.from(trayEl.children).indexOf(chip);
      if (idx !== -1) attachments.splice(idx, 1);
      chip.remove();
      if (!formEl.hidden) liftBubbleAboveInput();
    });
    chip.append(img, remove);
    trayEl.append(chip);
    if (!formEl.hidden) liftBubbleAboveInput();
  }

  function onStop(cb: () => void): void {
    stopHandlers.push(cb);
  }

  // When busy: swap send→stop icon + amber, dim the field, block submit.
  function setBusy(value: boolean): void {
    // A turn reaching the backend falsifies a standing error, whatever source started it; a busy already on starts none.
    if (value && !busy) clearInputError();
    busy = value;
    formEl.classList.toggle("is-running", value);
    actionButton.refresh();
  }

  // Single site for the static labels — applied here at construction, and again by
  // the same function on locale change (surfaces isn't remounted on locale change).
  function applyLocaleLabels(): void {
    attachBtn.setAttribute("aria-label", t("aria.attach_image"));
    field.placeholder = t("input.placeholder");
    field.setAttribute("aria-label", t("aria.input_field"));
  }
  applyLocaleLabels();
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  function setInputAnchor(bottomPx: number | null): void {
    if (bottomPx === null) formEl.style.removeProperty("--yui-input-bottom");
    else formEl.style.setProperty("--yui-input-bottom", `${bottomPx}px`);
    inputBottomPx = bottomPx ?? DEFAULT_INPUT_BOTTOM_PX;
    // If the input is up (summoned), update the bubble lift to match the feet anchor change.
    if (!formEl.hidden) liftBubbleAboveInput();
  }

  function submitCurrent(): void {
    const text = field.value.trim();
    if (text === "" && attachments.length === 0 && threads.length === 0) return;
    const images = attachments.slice();
    const intercepted = submitInterceptor?.(text, images);
    if (intercepted === "refused") {
      fitField();
      return;
    }
    if (intercepted !== "accepted" && busy) return;
    clearInputError();
    // A handler can redraw the chips; every one gets the chips this submit showed.
    const shown = threads;
    if (intercepted !== "accepted") for (const cb of submitHandlers) cb(text, images, shown);
    clearAttachments();
    field.value = "";
    fitField();
  }

  function restoreInput(text: string, images: string[]): void {
    if (!isInputOpen() || field.value !== "" || attachments.length > 0 || inFlight > 0) return;
    field.value = text;
    for (const url of images) {
      attachments.push(url);
      addChip(url);
    }
    fitField();
  }

  function handleSubmit(e: Event): void {
    e.preventDefault();
    submitCurrent();
  }

  function handleFieldKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      dismissInput();
      return;
    }
    // Textarea has no implicit submit; WebKit reports the IME-committing Enter as keyCode 229.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submitCurrent();
    }
  }
  // Typing clears the error; a Retry offer stays while the field holds a draft, and only its condition line goes.
  function clearErrorOnInput(): void {
    if (!formEl.classList.contains("is-error")) return;
    if (retryButton && hasDraft()) {
      if (conditionText) conditionText.nodeValue = "";
      retryButton.hidden = false;
    } else clearInputError();
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
    // Swallowed either way — a drop the webview handles itself navigates away from the app.
    e.preventDefault();
    if (limits) formEl.classList.add("is-dragover");
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
  field.addEventListener("keydown", handleFieldKey);
  field.addEventListener("input", clearErrorOnInput);
  field.addEventListener("input", fitField);
  field.addEventListener("paste", onFieldPaste);
  attachBtn.addEventListener("click", onAttachClick);
  picker.addEventListener("change", onPickerChange);
  formEl.addEventListener("dragover", onDragOver);
  formEl.addEventListener("dragleave", onDragLeave);
  formEl.addEventListener("drop", onDrop);

  function dispose(): void {
    unsubscribeLocale();
    submitInterceptor = undefined;
    formEl.removeEventListener("submit", handleSubmit);
    actionButton.dispose();
    field.removeEventListener("keydown", handleFieldKey);
    field.removeEventListener("input", clearErrorOnInput);
    field.removeEventListener("input", fitField);
    field.removeEventListener("paste", onFieldPaste);
    attachBtn.removeEventListener("click", onAttachClick);
    picker.removeEventListener("change", onPickerChange);
    formEl.removeEventListener("dragover", onDragOver);
    formEl.removeEventListener("dragleave", onDragLeave);
    formEl.removeEventListener("drop", onDrop);
    submitHandlers.length = 0;
    stopHandlers.length = 0;
    threadRemoveHandlers.length = 0;
  }

  return {
    summonInput,
    dismissInput,
    isInputOpen,
    onSubmit,
    interceptSubmit(fn) {
      submitInterceptor = fn;
    },
    onStop,
    setBusy,
    showInputError,
    setAttachmentLimits,
    restoreInput,
    setThreads,
    onThreadRemove(cb) {
      threadRemoveHandlers.push(cb);
    },
    setInputAnchor,
    dispose,
  };
}
