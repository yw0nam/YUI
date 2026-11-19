import { useSyncExternalStore } from "react";
import { getLocale, subscribe } from "../i18n";

const onLocale = (cb: () => void) => subscribe(() => cb());

/** Re-renders the calling component when the display language changes. */
export function useLocale(): string {
  return useSyncExternalStore(onLocale, getLocale);
}
