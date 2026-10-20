/** Application stores stop before the live key clears, so preset deletion waits for their last write. */
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { closeCompanions } from "../../io/window/openers/companion-windows";
import type { Logger } from "../../logger";
import {
  clearWindowLive,
  type PetWindows,
  setWindowLive,
  windowLabel,
} from "../../settings/preset/pet-windows";
import { isTauri } from "../../tauri-env";
import { waitForCompanions } from "./companion-window";

export function wireBoundWindow(deps: {
  boundId: string;
  petWindows: PetWindows;
  bridge: Pick<SettingsBridge, "emitPetWindowsChanged">;
  closeCompanions?: (id: string) => Promise<void>;
  disposeStores: () => void;
  disposeSync: () => void;
  close: () => void | Promise<void>;
  log: Logger;
}): () => void {
  const onPageHide = () => clearWindowLive(windowLabel("pet", deps.boundId));
  const browser = !isTauri();
  if (browser) window.addEventListener("pagehide", onPageHide);
  let closing = false;
  setWindowLive(windowLabel("pet", deps.boundId));
  const evaluate = () => {
    if (closing || deps.petWindows.get().includes(deps.boundId)) return;
    closing = true;
    void (async () => {
      void (deps.closeCompanions ?? closeCompanions)(deps.boundId).catch((error) =>
        deps.log.warn("companion_close_failed", { preset: deps.boundId, error: String(error) }),
      );
      await waitForCompanions(deps.boundId, deps.log);
      try {
        deps.disposeStores();
      } catch (error) {
        deps.log.warn("pet_window_dispose_failed", { preset: deps.boundId, error: String(error) });
      }
      clearWindowLive(windowLabel("pet", deps.boundId));
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
      try {
        deps.disposeSync();
      } catch (error) {
        deps.log.warn("pet_window_dispose_failed", { preset: deps.boundId, error: String(error) });
      } finally {
        deps.log.info("pet_window_close", { preset: deps.boundId });
        await deps.close();
      }
    })().catch((error) =>
      deps.log.error("pet_window_close_failed", { preset: deps.boundId, error: String(error) }),
    );
  };
  const off = deps.petWindows.subscribe(evaluate);
  evaluate();
  return () => {
    off();
    clearWindowLive(windowLabel("pet", deps.boundId));
    if (browser) window.removeEventListener("pagehide", onPageHide);
  };
}
