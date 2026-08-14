/**
 * Text input — submit/busy/error/anchor for the composer surface.
 *
 * Pure renderer — firing ≠ judgment: this only collects and forwards what the
 * user typed/attached. No brain, persona, or mode branching lives here.
 */

import { ATTACHMENT_LIMITS_DEFAULTS, type AttachmentLimits } from "../config";
import { subscribe as subscribeLocale, t } from "./i18n";
import { downscaleToJpeg } from "./image-resize";

/** In-place fix offered next to an inline error (e.g. "Open Advanced" on an unconfigured backend). */
export interface InputErrorAction {
  label: string;
  onClick(): void;
}

export interface TextInput {
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

export interface TextInputElements {
  formEl: HTMLFormElement;
  field: HTMLInputElement;
  errorEl: HTMLElement;
  trayEl: HTMLElement;
  attachBtn: HTMLButtonElement;
  picker: HTMLInputElement;
  sendBtn: HTMLButtonElement;
}

/** The speech bubble's positioning hooks — the input lifts the bubble above itself while open. */
export interface TextInputBubbleAnchor {
  liftAboveInput(totalOffsetPx: number): void;
  resetPosition(): void;
}

// Fallback input bottom (px) before the feet anchor arrives. The starting point
// for the calculation that lifts the bubble above the input when it opens.
const DEFAULT_INPUT_BOTTOM_PX = 48;
// Minimum gap (px) between the bubble bottom and the input top.
const BUBBLE_INPUT_GAP_PX = 12;

export function createTextInput(
  { formEl, field, errorEl, trayEl, attachBtn, picker, sendBtn }: TextInputElements,
  bubble: TextInputBubbleAnchor,
): TextInput {
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  const attachments: string[] = [];
  // Accepted but still being read into a data URL — counts against max_count so a
  // single multi-file drop cannot slip past the cap.
  let inFlight = 0;
  // Bumped by clearAttachments — reads started for an earlier turn are discarded.
  let epoch = 0;
  // Defaults until setAttachmentLimits delivers the configured caps.
  let limits: AttachmentLimits = ATTACHMENT_LIMITS_DEFAULTS;
  // Backend processing — the send button becomes stop and submit is blocked.
  let busy = false;
  // Input bottom offset (px) — updated by setInputAnchor, used to lift the bubble while the input is open.
  let inputBottomPx = DEFAULT_INPUT_BOTTOM_PX;

  // While the input is open, lift the bubble above it to prevent overlap.
  // Bubble bottom = input bottom + input height + gap. Even if the feet anchor changes each frame,
  // setInputAnchor re-calls this to update just the value (class toggle happens once).
  function liftBubbleAboveInput(): void {
    bubble.liftAboveInput(inputBottomPx + formEl.offsetHeight + BUBBLE_INPUT_GAP_PX);
  }

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
        bubble.resetPosition();
      }
    };
    formEl.addEventListener("transitionend", onEnd);
  }

  function isInputOpen(): boolean {
    return formEl.classList.contains("is-open");
  }

  function clearInputError(): void {
    formEl.classList.remove("is-error");
    errorEl.textContent = "";
  }

  function showInputError(message: string, action?: InputErrorAction): void {
    errorEl.textContent = message;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yui-input__error-action";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
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
    formEl.classList.add("is-error");
    formEl.classList.remove("is-pending");
  }

  function onSubmit(cb: (text: string, images: string[]) => void): void {
    submitHandlers.push(cb);
  }

  function setAttachmentLimits(next: AttachmentLimits): void {
    limits = next;
  }

  function clearAttachments(): void {
    attachments.length = 0;
    inFlight = 0;
    epoch++;
    trayEl.replaceChildren();
  }

  function addFiles(files: FileList | File[]): void {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
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
        .finally(() => {
          if (batch === epoch) inFlight--;
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
    // A turn reaching the backend falsifies a standing error, whatever source started it.
    if (value) clearInputError();
    formEl.classList.toggle("is-running", value);
    sendBtn.setAttribute("aria-label", value ? t("aria.stop") : t("aria.send"));
  }

  // Single site for these four labels — applied here at construction, and again by
  // the same function on locale change (surfaces isn't remounted on locale change).
  function applyLocaleLabels(): void {
    attachBtn.setAttribute("aria-label", t("aria.attach_image"));
    field.placeholder = t("input.placeholder");
    field.setAttribute("aria-label", t("aria.input_field"));
    sendBtn.setAttribute("aria-label", busy ? t("aria.stop") : t("aria.send"));
  }
  applyLocaleLabels();
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
    if (formEl.classList.contains("is-error")) clearInputError();
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

  function dispose(): void {
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
    submitHandlers.length = 0;
    stopHandlers.length = 0;
  }

  return {
    summonInput,
    dismissInput,
    isInputOpen,
    onSubmit,
    onStop,
    setBusy,
    showInputError,
    setAttachmentLimits,
    setInputEnabled,
    setInputAnchor,
    dispose,
  };
}
