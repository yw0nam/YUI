/** Application stores stop before the live key clears, so preset deletion waits for their last write. */
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { Logger } from "../../logger";
import {
  clearPetWindowLive,
  type PetWindows,
  setPetWindowLive,
} from "../../settings/preset/pet-windows";
import { isTauri } from "../../tauri-env";

export function wireBoundWindow(deps: {
  boundId: string;
  petWindows: PetWindows;
  bridge: Pick<SettingsBridge, "emitPetWindowsChanged">;
  disposeStores: () => void;
  disposeSync: () => void;
  close: () => void | Promise<void>;
  log: Logger;
}): () => void {
  const onPageHide = () => clearPetWindowLive(deps.boundId);
  const browser = !isTauri();
  if (browser) window.addEventListener("pagehide", onPageHide);
  let closing = false;
  setPetWindowLive(deps.boundId);
  const evaluate = () => {
    if (closing || deps.petWindows.get().includes(deps.boundId)) return;
    closing = true;
    void (async () => {
      try {
        deps.disposeStores();
      } catch (error) {
        deps.log.warn("pet_window_dispose_failed", { preset: deps.boundId, error: String(error) });
      }
      clearPetWindowLive(deps.boundId);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deps.bridge.emitPetWindowsChanged(),
          new Promise<void>((r) => {
            timer = setTimeout(r, 250);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (browser) window.removeEventListener("pagehide", onPageHide);
      deps.disposeSync();
      deps.log.info("pet_window_close", { preset: deps.boundId });
      await deps.close();
    })().catch((error) =>
      deps.log.error("pet_window_close_failed", { preset: deps.boundId, error: String(error) }),
    );
  };
  const off = deps.petWindows.subscribe(evaluate);
  evaluate();
  return () => {
    off();
    if (browser) window.removeEventListener("pagehide", onPageHide);
  };
}
