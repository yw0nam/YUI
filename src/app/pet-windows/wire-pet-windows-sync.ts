/** Window intent and live-key notifications reread storage without echoing remote changes. */
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import {
  LIVE_KEY_PREFIX,
  PET_WINDOWS_KEY,
  type PetWindows,
} from "../../settings/preset/pet-windows";

export function wirePetWindowsSync(deps: {
  petWindows: PetWindows;
  bridge: Pick<SettingsBridge, "emitPetWindowsChanged" | "onPetWindowsChanged">;
}): () => void {
  let applyingRemote = false;
  const read = () => {
    applyingRemote = true;
    try {
      deps.petWindows.reloadFromStorage();
      deps.petWindows.invalidate();
    } finally {
      applyingRemote = false;
    }
  };
  const offStore = deps.petWindows.subscribe(() => {
    if (!applyingRemote) void deps.bridge.emitPetWindowsChanged();
  });
  const offBridge = deps.bridge.onPetWindowsChanged(read);
  const storage = (e: StorageEvent) => {
    if (e.key === null || e.key === PET_WINDOWS_KEY || e.key.startsWith(LIVE_KEY_PREFIX)) read();
  };
  window.addEventListener("storage", storage);
  read();
  return () => {
    offStore();
    offBridge();
    window.removeEventListener("storage", storage);
  };
}
