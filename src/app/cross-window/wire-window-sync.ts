import type { Guardrails, GuardrailsConfig } from "../../dispatcher/core/guardrails";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import {
  createSettingsBridge,
  type SettingsBridge,
  type WindowKind,
} from "../../io/bridge/settings-bridge";
import type { createSpeakerSelection } from "../../io/voice/voices/speaker-selection";
import { wireStorageSync } from "../../io/window/openers/settings-window";
import type { Logger } from "../../logger";
import type { VrmLoadResult } from "../../renderer";
import type { GuardrailsSettingsStore } from "../../settings/backend/guardrails-settings";
import {
  broadcastSyncStores,
  reloadSyncStores,
  type SettingsStores,
  type SyncedStore,
} from "../../settings/settings-stores";
import {
  reloadFromStorage as reloadLocaleFromStorage,
  subscribe as subscribeLocale,
} from "../../ui/i18n";

/**
 * Cross-window settings broadcast half (loop-guarded, debounced). Local edits to any synced store
 * (plus display language) emit a single settings-changed event after a 200ms idle. Must be
 * wired BEFORE the VRM/speaker selections, since they broadcast through the returned `broadcastSettings`.
 * `runApplyingRemote` is handed to the reload half so remote applies suppress re-broadcast (loop guard).
 */
export function createSettingsBroadcast(deps: {
  bridge: Pick<SettingsBridge, "emitSettingsChanged">;
  syncedStores: SyncedStore[];
}): {
  broadcastSettings: () => void;
  runApplyingRemote: (apply: () => void) => void;
  dispose: () => void;
} {
  const { bridge, syncedStores } = deps;
  let applyingRemote = false;
  let disposed = false;
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  // Debounce: consolidate slider drag/typing bursts into a single cross-window event after 200ms idle.
  // No-op while a remote apply is in flight, so the round-trip terminates. Callers hold this callback
  // past dispose (VRM/speaker selections), so a post-dispose notify must not re-arm the timer.
  const broadcastSettings = (): void => {
    if (disposed || applyingRemote) return;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      bridge.emitSettingsChanged();
    }, 200);
  };
  // Wrap the reload path so store writes during a remote apply don't re-broadcast (loop guard).
  const runApplyingRemote = (apply: () => void): void => {
    applyingRemote = true;
    try {
      apply();
    } finally {
      applyingRemote = false;
    }
  };
  const unsubscribers = syncedStores.map((store) => store.subscribe(broadcastSettings));
  // Display language also syncs cross-window: broadcast changes here, reapply from storage on remote change.
  unsubscribers.push(subscribeLocale(broadcastSettings));
  const dispose = (): void => {
    disposed = true;
    // Flush a pending broadcast rather than drop it: teardown commits (dirty endpoint/key fields)
    // land inside the debounce window, and the other window still needs to hear them.
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
      bridge.emitSettingsChanged();
    }
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
  return { broadcastSettings, runApplyingRemote, dispose };
}

/**
 * Editable rate-limit caps → the running limiter. setConfig replaces config values only, so an edit
 * re-caps the limiter with its rolling counters intact. Returns the unsubscribe.
 */
export function wireGuardrailsOverrides(deps: {
  guardrails: Pick<Guardrails, "setConfig">;
  store: Pick<GuardrailsSettingsStore, "subscribe">;
  getGuardrails: () => GuardrailsConfig;
}): () => void {
  return deps.store.subscribe(() => deps.guardrails.setConfig(deps.getGuardrails()));
}

/**
 * The four-part cross-window sync every window runs: the localStorage-`storage`-event fallback, the
 * bridge, the loop-guarded debounced broadcast half, and the remote-change reload half. Window-specific
 * extras (the conversation stores every window passes, pet's mouth-preview/voice channels and VRM
 * hot-swap) layer on top through `extraReload`/`extraBroadcast` and `onRemoteChange`.
 */
export function wireWindowSync(deps: {
  stores: SettingsStores;
  windowKind: WindowKind;
  /** Stores reloaded with the registry set on a storage event, a remote change, and focus. */
  extraReload?: ReadonlyArray<{ reloadFromStorage(): void }>;
  /** Stores whose local edits broadcast with the settings broadcast set. */
  extraBroadcast?: ReadonlyArray<SyncedStore>;
  log: Logger;
}): {
  bridge: SettingsBridge;
  broadcastSettings: () => void;
  /** Reload every resync store + display language. */
  reload: () => void;
  /** Registers extra work to run inside the remote-change loop guard, after the resync reload. */
  onRemoteChange(cb: () => void): void;
  dispose(): void;
} {
  const { stores, windowKind, extraReload, extraBroadcast, log } = deps;
  let disposed = false;
  const resyncStores = [...reloadSyncStores(stores), ...(extraReload ?? [])];
  const remoteHooks: Array<() => void> = [];
  const reload = (): void => {
    if (disposed) return;
    for (const store of resyncStores) store.reloadFromStorage();
    // Display language changed in the other window → i18n.subscribe remount callback redraws UI.
    reloadLocaleFromStorage();
  };
  const bridge = createSettingsBridge(undefined, { windowKind });
  const {
    broadcastSettings,
    runApplyingRemote,
    dispose: disposeBroadcast,
  } = createSettingsBroadcast({
    bridge,
    syncedStores: [...broadcastSyncStores(stores), ...(extraBroadcast ?? [])],
  });
  // Run under the same loop guard as the bridge-driven reload below — a sibling window's
  // localStorage write fires "storage" here too, and without the guard its
  // store.subscribe(broadcastSettings) would re-broadcast the change it just received.
  const disposeStorageSync = wireStorageSync([
    {
      reloadFromStorage: () =>
        runApplyingRemote(() => {
          for (const store of resyncStores) store.reloadFromStorage();
        }),
    },
  ]);
  const disposeSettingsChanged = bridge.onSettingsChanged((from) => {
    runApplyingRemote(() => {
      reload();
      for (const cb of remoteHooks) cb();
    });
    log.info("settings_change_received", { source: from });
  });
  return {
    bridge,
    broadcastSettings,
    reload,
    onRemoteChange(cb) {
      remoteHooks.push(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeStorageSync();
      disposeBroadcast();
      disposeSettingsChanged();
      bridge.dispose();
    },
  };
}

/**
 * Pet-window half of the remote-change reload: the renderer-backed VRM hot-swap plus the speaker
 * selection. Registered as a core hook AFTER the VRM/speaker selections exist. Only OTHER-window
 * changes reach here, so the VRM is hot-swapped only when its URL actually changed (this window's
 * own swap already loaded it).
 */
export function wireSettingsReload(deps: {
  onRemoteChange: (cb: () => void) => void;
  vrmSelection: Pick<ReturnType<typeof createVrmSelection>, "getActive" | "reloadFromStorage">;
  loadVrmSerialized: (url: string) => Promise<VrmLoadResult>;
  speakerSelection: Pick<ReturnType<typeof createSpeakerSelection>, "reloadFromStorage">;
  log: Logger;
}): void {
  const { onRemoteChange, vrmSelection, loadVrmSerialized, speakerSelection, log } = deps;
  onRemoteChange(() => {
    // VRM selection is committed store-only in the settings window; reflect it to this window's renderer.
    const prevVrmUrl = vrmSelection.getActive().url;
    vrmSelection.reloadFromStorage();
    const nextVrmUrl = vrmSelection.getActive().url;
    if (nextVrmUrl !== prevVrmUrl) {
      void loadVrmSerialized(nextVrmUrl).catch((err) =>
        log.error("vrm_cross_window_swap_failed", { error: String(err) }),
      );
    }
    // Speaker selection is store-only — synth reads via getActive() on the next utterance, so just reload.
    speakerSelection.reloadFromStorage();
  });
}
