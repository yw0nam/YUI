/**
 * The composer's action button — the one control at the row's end. A running turn makes it stop;
 * otherwise it submits the form. Its label follows the mode and the locale.
 */

import { subscribe as subscribeLocale, t } from "../i18n";

export interface ActionButton {
  /** Re-derive the mode and its label from the composer's state. */
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

  function refresh(): void {
    button.setAttribute("aria-label", busy() ? t("aria.stop") : t("aria.send"));
  }

  // While busy a click stops the turn instead of submitting; otherwise it passes through as type=submit.
  function handleClick(e: Event): void {
    if (!busy()) return;
    e.preventDefault();
    onStop();
  }

  // A button takes focus on click in Chromium and the Android WebView, which closes the soft keyboard; the field keeps it.
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
