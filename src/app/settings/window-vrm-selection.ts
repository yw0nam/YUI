/**
 * window-vrm-selection — the store-only VRM selection a window without a renderer owns:
 * commit and cross-window reload only; the pet window hot-swaps the model on the change.
 */

import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "../../io/assets/vrm-selection";
import type { ConfigStore } from "../../config/store";
import type { Logger } from "../../logger";

export function createWindowVrmSelection(deps: {
  /** The loaded config, or null while the best-effort load has not finished. */
  config: Pick<ConfigStore, "get"> | null;
  log: Logger;
}): {
  vrmSelection: ReturnType<typeof createVrmSelection>;
  swapVrm: (option: { id: string }) => Promise<void>;
} {
  const vrmSelection = createVrmSelection({
    defaultValue: "/vrms/Sendagaya_Shino.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  if (deps.config) {
    try {
      const avatar = deps.config.get().avatar;
      vrmSelection.setManifest({ available: avatar.available, defaultValue: avatar.vrm_url });
    } catch (err) {
      deps.log.warn("avatar_config_read_failed", { fallback: true, error: String(err) });
    }
  }
  const swapVrm = async (option: { id: string }): Promise<void> => {
    vrmSelection.select(option.id);
  };
  return { vrmSelection, swapVrm };
}
