import { isTauri } from "../../tauri-env";
import type { FlagSettingsStore } from "../persisted-store";
import { readOpenPresetIds } from "../preset/pet-windows";

/** Whether the unified chat window is shown: the switch on, two or more presets open, and a window can exist. */
export interface UnifiedShown {
  get(): boolean;
  /** Fires only when the value changes. */
  subscribe(cb: (shown: boolean) => void): () => void;
}

/** Shown while the Unified chat switch is on, two or more presets are open and a window can exist. */
export function createUnifiedShown(deps: {
  switch: Pick<FlagSettingsStore, "get" | "subscribe">;
  onPetWindowsChanged: (cb: () => void) => () => void;
  openPresetIds?: () => string[];
  canOpen?: () => boolean;
}): UnifiedShown & { dispose(): void } {
  const { openPresetIds = readOpenPresetIds, canOpen = isTauri } = deps;
  const compute = (): boolean =>
    deps.switch.get().enabled && openPresetIds().length >= 2 && canOpen();
  const listeners = new Set<(shown: boolean) => void>();
  let last = compute();
  const recompute = (): void => {
    const next = compute();
    if (next === last) return;
    last = next;
    for (const cb of [...listeners]) cb(next);
  };
  const offSwitch = deps.switch.subscribe(recompute);
  const offWindows = deps.onPetWindowsChanged(recompute);
  return {
    get: compute,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      offSwitch();
      offWindows();
      listeners.clear();
    },
  };
}
