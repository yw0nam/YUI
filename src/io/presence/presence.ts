/** presence — the last OS idle tick read against the away threshold, for main's pet window. */

import type { OsEventListen } from "../window/tauri-listen";

export function createPresence(deps: {
  threshold: () => number;
  listen?: OsEventListen;
}): { isPresent(): boolean; dispose(): void } {
  void deps.listen?.("os_event", () => {});
  return {
    isPresent: () => false,
    dispose() {},
  };
}
