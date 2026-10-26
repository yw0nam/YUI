import type { FlagSettingsStore } from "../../settings/persisted-store";
import type { UnifiedShown } from "../../settings/unified/unified-chat-switch";

/** Shown while the Unified chat switch is on, two or more presets are open and a window can exist. */
export function createUnifiedShown(deps: {
  switch: Pick<FlagSettingsStore, "get" | "subscribe">;
  openPresetIds: () => string[];
  onPetWindowsChanged: (cb: () => void) => () => void;
  canOpen: () => boolean;
}): UnifiedShown & { dispose(): void } {
  const compute = (): boolean =>
    deps.switch.get().enabled && deps.openPresetIds().length >= 2 && deps.canOpen();
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
