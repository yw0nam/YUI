/**
 * Preset switch — every store resolves its keys once at boot, so a window follows a change of the
 * active preset by reloading. Every registry edit in this window goes out over the settings bridge;
 * another window's arrives over it, with the registry key's `storage` event as the fallback.
 */

import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { PRESETS_KEY } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";

/** Longest wait for the switch message to leave before the reload goes ahead without it. */
const EMIT_WAIT_MS = 250;

export function wirePresetSwitch(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe" | "reloadFromStorage">;
  bridge: Pick<SettingsBridge, "emitPresetChanged" | "onPresetChanged">;
  /** Runs once before the reload; the pet window stops its turn and speech here. */
  boundId?: string | null;
  onBeforeReload?: () => void;
  reload?: () => void;
}): () => void {
  const { registry, bridge, onBeforeReload, reload = () => location.reload() } = deps;
  const bootId = registry.get().active;
  let switching = false;
  // Set while a change from another window is read in, so it is not sent back out.
  let applyingRemote = false;

  // `sent` is this window's own switch message: the page unloading before it leaves would lose it.
  function follow(sent?: Promise<void>): void {
    if (switching || deps.boundId != null) return;
    switching = true;
    onBeforeReload?.();
    if (!sent) {
      reload();
      return;
    }
    const waited = new Promise<void>((resolve) => setTimeout(resolve, EMIT_WAIT_MS));
    void Promise.race([sent, waited]).then(reload);
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
    if (switching) return;
    const sent = applyingRemote ? undefined : bridge.emitPresetChanged({ active: s.active });
    if (s.active !== bootId) follow(sent);
  });
  // The bridge skips a window's own emits, so this hears other windows only.
  const offBridge = bridge.onPresetChanged(({ active }) => {
    readRemote();
    if (active !== bootId) follow();
  });
  // A list edit in another window lands here too, so the next edit here starts from it.
  const onStorage = (e: StorageEvent): void => {
    if (e.key === PRESETS_KEY || e.key === null) readRemote();
  };
  window.addEventListener("storage", onStorage);
  // A switch made while this window booted reached no listener; storage still holds it.
  readRemote();

  return () => {
    unsubscribe();
    offBridge();
    window.removeEventListener("storage", onStorage);
  };
}
