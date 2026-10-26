/**
 * The composer's action button — the one control at the row's end. A running turn makes it stop;
 * otherwise it sends. Its mode and label follow the composer and the locale.
 */

import { subscribe as subscribeLocale, t } from "../i18n";

type ActionMode = "stop" | "send";

export interface ActionButton {
  /** Re-derive the mode and label from the composer. */
  refresh(): void;
  dispose(): void;
}

export function createActionButton(deps: {
  button: HTMLButtonElement;
  /** Whether a turn runs. */
  busy: () => boolean;
  onStop: () => void;
}): ActionButton {
  const { button, busy, onStop } = deps;

  function modeNow(): ActionMode {
    return busy() ? "stop" : "send";
  }

  function refresh(): void {
    const mode = modeNow();
    button.dataset.mode = mode;
    button.type = mode === "send" ? "submit" : "button";
    button.setAttribute("aria-label", t(mode === "stop" ? "aria.stop" : "aria.send"));
  }

  // Stop acts on a click; send passes through as type=submit. A mode change the action
  // itself causes must not turn the same click into a submit, hence the preventDefault.
  function handleClick(e: Event): void {
    if (button.dataset.mode === "send") return;
    e.preventDefault();
    onStop();
  }

  // A button takes focus on click; the field keeps it.
  function keepFieldFocus(e: Event): void {
    e.preventDefault();
  }

  refresh();
  const unsubscribeLocale = subscribeLocale(refresh);
  button.addEventListener("click", handleClick);
  button.addEventListener("mousedown", keepFieldFocus);

  return {
    refresh,
    dispose(): void {
      unsubscribeLocale();
      button.removeEventListener("click", handleClick);
      button.removeEventListener("mousedown", keepFieldFocus);
    },
  };
}
