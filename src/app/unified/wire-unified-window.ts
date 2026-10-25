import type { FlagSettingsStore } from "../../settings/persisted-store";

/** Main opens the unified chat window while its switch is on and two or more presets are open, and closes it otherwise. */
export function wireUnifiedWindow(deps: {
  switch: Pick<FlagSettingsStore, "get" | "subscribe">;
  openPresetIds: () => string[];
  onPetWindowsChanged: (cb: () => void) => () => void;
  window: { open(): void; close(): void };
}): () => void {
  const apply = (): void => {
    if (deps.switch.get().enabled && deps.openPresetIds().length >= 2) deps.window.open();
    else deps.window.close();
  };
  apply();
  const offSwitch = deps.switch.subscribe(apply);
  const offWindows = deps.onPetWindowsChanged(apply);
  return () => {
    offSwitch();
    offWindows();
  };
}
