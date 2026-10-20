/**
 * Preset switch — every store resolves its keys once at boot, so a window follows a change of the
 * active preset by reloading. This window's own activation goes out over the settings bridge; another
 * window's arrives over it, with the registry key's `storage` event as the fallback.
 */

import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { PRESETS_KEY } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";

export function wirePresetSwitch(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe" | "reloadFromStorage">;
  bridge: Pick<SettingsBridge, "emitPresetChanged" | "onPresetChanged">;
  /** Runs once before the reload; the pet window stops its turn and speech here. */
  onBeforeReload?: () => void;
  reload?: () => void;
}): () => void {
  const { registry, bridge, onBeforeReload, reload = () => location.reload() } = deps;
  const bootId = registry.get().active;
  let switching = false;
  // Set while a change from another window is read in, so it is not sent back out.
  let applyingRemote = false;

  function follow(): void {
    if (switching) return;
    switching = true;
    onBeforeReload?.();
    reload();
  }

  function readRemote(): void {
    applyingRemote = true;
    try {
      registry.reloadFromStorage();
    } finally {
      applyingRemote = false;
    }
  }

  const unsubscribe = registry.subscribe((s) => {
    if (switching || s.active === bootId) return;
    if (!applyingRemote) bridge.emitPresetChanged({ active: s.active });
    follow();
  });
  // The bridge skips a window's own emits, so this hears other windows only.
  const offBridge = bridge.onPresetChanged(({ active }) => {
    if (active === bootId) return;
    readRemote();
    follow();
  });
  // A list edit in another window lands here too, so the next edit here starts from it.
  const onStorage = (e: StorageEvent): void => {
    if (e.key === PRESETS_KEY || e.key === null) readRemote();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    unsubscribe();
    offBridge();
    window.removeEventListener("storage", onStorage);
  };
}
