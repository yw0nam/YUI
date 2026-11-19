/** The display language as a signal, so a binding that reads a translation re-runs when it changes. */

import { createSignal } from "solid-js";
import { getLocale, subscribe, t } from "../i18n";

const [locale, setLocale] = createSignal(getLocale());
subscribe(setLocale);

/** Runs `fn` under the locale signal. */
export function localized<T>(fn: () => T): T {
  locale();
  return fn();
}

export const tr = (key: string): string => localized(() => t(key));
