/**
 * Preset switch — every store resolves its keys once at boot, so a window follows a change of the
 * active preset by reloading. The change arrives from this window's registry or, from another
 * window, as a `storage` event on the registry key.
 */

import { PRESETS_KEY } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";

export function wirePresetSwitch(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe" | "reloadFromStorage">;
  /** Runs once before the reload; the pet window stops its turn and speech here. */
  onBeforeReload?: () => void;
  reload?: () => void;
}): () => void {
  const { registry, onBeforeReload, reload = () => location.reload() } = deps;
  const bootId = registry.get().active;
  let switching = false;

  function follow(active: string): void {
    if (switching || active === bootId) return;
    switching = true;
    onBeforeReload?.();
    reload();
  }

  const unsubscribe = registry.subscribe((s) => follow(s.active));
  // A list edit in another window lands here too, so the next edit here starts from it.
  const onStorage = (e: StorageEvent): void => {
    if (e.key === PRESETS_KEY || e.key === null) registry.reloadFromStorage();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}
