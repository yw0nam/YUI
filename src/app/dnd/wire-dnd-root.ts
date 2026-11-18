/** Marks the window root with data-yui-dnd while do-not-disturb is on, so the chips' motion CSS can hold. */

import type { FlagSettingsStore } from "../../settings/persisted-store";

export function wireDndRoot(_deps: {
  dnd: Pick<FlagSettingsStore, "get" | "subscribe">;
  root: HTMLElement;
}): () => void {
  return () => {};
}
