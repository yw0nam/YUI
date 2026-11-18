/** Marks the window root with data-yui-dnd while do-not-disturb is on, so the urgent signal chip's pulse can hold. */

import type { FlagSettingsStore } from "../../settings/persisted-store";

export function wireDndRoot(deps: {
  dnd: Pick<FlagSettingsStore, "get" | "subscribe">;
  root: HTMLElement;
}): () => void {
  const { dnd, root } = deps;
  const sync = (): void => {
    if (dnd.get().enabled) root.setAttribute("data-yui-dnd", "");
    else root.removeAttribute("data-yui-dnd");
  };
  sync();
  return dnd.subscribe(sync);
}
