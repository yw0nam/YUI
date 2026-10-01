/**
 * The composer's action button — the one control at the row's end. Priority: a running turn makes
 * it stop; something to send makes it send; otherwise, where the host gives a mic port, it is the
 * mic. Its mode, label and live state follow the composer, the mic port and the locale.
 */

import { subscribe as subscribeLocale, t } from "../i18n";

/** The mic the button toggles: its wish, whether it is healthy, and the changes to either. */
export interface MicPort {
  wanted(): boolean;
  live(): boolean;
  subscribe(cb: () => void): () => void;
  toggle(): void;
}

type ActionMode = "stop" | "send" | "mic";

export interface ActionButton {
  /** Re-derive the mode, label and live state from the composer and the mic port. */
  refresh(): void;
  dispose(): void;
}

export function createActionButton(deps: {
  button: HTMLButtonElement;
  /** Whether a turn runs. */
  busy: () => boolean;
  /** Whether the composer holds text, an attachment, or one still being read. */
  hasContent: () => boolean;
  /** Without it the button never becomes the mic. */
  mic?: MicPort;
  onStop: () => void;
}): ActionButton {
  const { button, busy, hasContent, mic, onStop } = deps;

  function modeNow(): ActionMode {
    if (busy()) return "stop";
    if (hasContent() || mic === undefined) return "send";
    return "mic";
  }

  function ariaLabel(mode: ActionMode): string {
    if (mode === "stop") return t("aria.stop");
    if (mode === "send") return t("aria.send");
    return t(mic?.wanted() ? "phone.voice.stop_aria" : "phone.voice.start_aria");
  }

  function refresh(): void {
    const mode = modeNow();
    button.dataset.mode = mode;
    button.type = mode === "send" ? "submit" : "button";
    button.setAttribute("aria-label", ariaLabel(mode));
    button.classList.toggle("is-live", mode === "mic" && mic?.live() === true);
  }

  // Stop and mic act on a click; send passes through as type=submit. A mode change the action
  // itself causes must not turn the same click into a submit, hence the preventDefault.
  function handleClick(e: Event): void {
    const mode = button.dataset.mode;
    if (mode === "send") return;
    e.preventDefault();
    if (mode === "stop") onStop();
    else mic?.toggle();
  }

  // A button takes focus on click in Chromium and the Android WebView, which closes the soft keyboard; the field keeps it.
  function keepFieldFocus(e: Event): void {
    e.preventDefault();
  }

  refresh();
  const unsubscribeLocale = subscribeLocale(refresh);
  const unsubscribeMic = mic?.subscribe(refresh);
  button.addEventListener("click", handleClick);
  button.addEventListener("mousedown", keepFieldFocus);

  return {
    refresh,
    dispose(): void {
      unsubscribeLocale();
      unsubscribeMic?.();
      button.removeEventListener("click", handleClick);
      button.removeEventListener("mousedown", keepFieldFocus);
    },
  };
}
