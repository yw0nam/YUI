/** Bootstrap wiring helpers extracted from main.ts: VRM + speaker selection stores and their swap/import flows. */
import { createFaller, type Faller } from "./ambient/faller";
import type { Tier1Engine } from "./ambient/tier1";
import { createWalker, type Walker } from "./ambient/walker";
import {
  type AppConfig,
  type ConfigSection,
  type FallConfig,
  type GestureCuesConfig,
  loadEmotionTextTable,
  type PeekConfig,
  type ScreenConfig,
  type WalkConfig,
} from "./config";
import type { EndpointsConfig, MotionKind, Posture, WindowRect } from "./contract";
import { createAgentSource } from "./dispatcher/agent-source";
import type { Dispatcher } from "./dispatcher/dispatcher";
import type { EventBus } from "./dispatcher/event-bus";
import type { Guardrails, GuardrailsConfig } from "./dispatcher/guardrails";
import type { ProactivePacer } from "./dispatcher/proactive-pacer";
import { createProactiveSource, type ProactiveSource } from "./dispatcher/proactive-source";
import { createScheduleSource, type ScheduleSource } from "./dispatcher/schedule-source";
import { createScreenSource, type ScreenSource } from "./dispatcher/screen-source";
import { createSignalsSource, type SignalsSource } from "./dispatcher/signals-source";
import type { UserInputSource } from "./dispatcher/user-input-source";
import type { AgentNotifySettings } from "./io/agent-notify-settings";
import { resolveAssetUrl, resolveUserFileSrc } from "./io/asset-url";
import { type AvatarExecutor, createAvatarExecutor } from "./io/avatar-executor";
import { onAvatarRpc, respondAvatarRpc } from "./io/avatar-rpc";
import {
  type BrokerClient,
  type BrokerPayload,
  createBrokerClient,
  deriveBrokerPayload,
} from "./io/broker-client";
import { createBrokerOverrideReconciler } from "./io/broker-override-reconciler";
import { selectFetch } from "./io/chat-client";
import { type EndpointOverrides, mergeEndpoints } from "./io/endpoints-settings";
import type { ExpressMotionSettings } from "./io/express-motion-settings";
import type { GuardrailsSettingsStore } from "./io/guardrails-settings";
import type { ClampedIntSettingsStore } from "./io/persisted-store";
import type { ProactiveSettings } from "./io/proactive-settings";
import type { ScheduleSettings } from "./io/schedule-settings";
import { type PetWindow, toScreenMonitor } from "./io/screen-geometry";
import { createSettingsBridge, type SettingsBridge, type WindowKind } from "./io/settings-bridge";
import {
  broadcastSyncStores,
  reloadSyncStores,
  type SettingsStores,
  type SyncedStore,
} from "./io/settings-stores";
import { wireStorageSync } from "./io/settings-window";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import type { SttVad } from "./io/stt-vad";
import { createSummonHotkey, type SummonHotkey } from "./io/summon-hotkey";
import { isTauri } from "./io/tauri-env";
import { deleteVoice, upsertVoice } from "./io/tts-voices";
import { appendRecord } from "./io/turn-record-log";
import { removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { createVoiceImportFlow } from "./io/voice-import-flow";
import { createVoiceListRefresh } from "./io/voice-list-refresh";
import { importVrmFromFile, removeOrphanVrm, removeUserVrm } from "./io/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./io/vrm-selection";
import { createWindowDropSource } from "./io/window-drop-source";
import { createWindowResizeSource } from "./io/window-resize-source";
import type { Logger } from "./logger";
import type { Renderer, VrmLoadResult } from "./renderer";
import {
  reloadFromStorage as reloadLocaleFromStorage,
  subscribe as subscribeLocale,
} from "./ui/i18n";
import type { Surfaces } from "./ui/surfaces";
import type { VoiceInputStatus } from "./ui/voice-input-status";

export function wireVrmSelection(deps: {
  renderer: Renderer;
  log: Logger;
  broadcastSettings: () => void;
}): {
  vrmSelection: ReturnType<typeof createVrmSelection>;
  loadVrmSerialized: (url: string) => Promise<VrmLoadResult>;
  swapVrm: (option: { id: string; url: string }) => Promise<void>;
  importVrm: () => Promise<void>;
} {
  const { renderer, log, broadcastSettings } = deps;
  // VRM selection store + swap. The pet window is renderer-backed: commit the store
  // only after loadVRM succeeds. Starts with a fallback default since config is not
  // loaded yet — the panel is needed early. After config loads, setManifest injects
  // the real available[] (see the boot sequence below).
  const vrmSelection = createVrmSelection({
    defaultValue: "/vrms/Sendagaya_Shino.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  // Single serial swap path: user swap, boot, config hot-reload, and cross-window all
  // pass through this chain. loadVRM is not re-entrant safe, so serialize it while
  // still propagating failures to the caller.
  let vrmSwap: Promise<unknown> = Promise.resolve();
  function loadVrmSerialized(url: string): Promise<VrmLoadResult> {
    // Resolve the logical path (/vrms/*.vrm) to a runtime URL — dev passthrough, Tauri bundled-resource absolute URL.
    const next = vrmSwap.then(async () => renderer.loadVRM(await resolveAssetUrl(url)));
    vrmSwap = next.catch(() => {}); // keep the chain alive even on failure,
    return next; // but propagate the reject only to this caller.
  }
  // Commit the store only on load success. On failure the await throws → store not committed (UI shows error + auto-recovers).
  const swapVrm = async (option: { id: string; url: string }): Promise<void> => {
    await loadVrmSerialized(option.url);
    vrmSelection.select(option.id);
  };
  // BYO-VRM import: pick file → copy → load → (label from meta name if present) → add option + select.
  // Cancel (null) is silently ignored. On load failure, delete the orphan file and throw without
  // adding the option (prior selection/renderer stay as-is — no recovery needed since the load
  // fails before currentVrm is replaced).
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile();
    if (option === null) return; // cancel
    let metaName: string | null;
    try {
      const src = await resolveUserFileSrc(option.url);
      ({ metaName } = await loadVrmSerialized(src));
    } catch (err) {
      // Remove the orphan copy — don't swallow a failure, surface it as a warning (the original error is still thrown).
      await removeOrphanVrm(option.id, removeUserVrm, (e) =>
        log.warn("orphan_vrm_cleanup_failed", { error: String(e) }),
      );
      log.error("imported_vrm_load_failed", { error: String(err) });
      throw err;
    }
    const labelled = metaName ? { ...option, label: metaName } : option;
    vrmSelection.addUserOption(labelled);
    vrmSelection.select(labelled.id);
  };
  // Announce cross-window so the VRM picked in this window reflects in the settings-window UI (loop guard lives in broadcastSettings).
  vrmSelection.subscribe(broadcastSettings);
  return { vrmSelection, loadVrmSerialized, swapVrm, importVrm };
}

/**
 * Effective endpoints for a window whose config load is best-effort: user overrides layered on the
 * bundled config, or null while the config has not loaded. Both sides are read per call, so a live
 * override edit takes effect without rewiring. Network consumers read through this — a URL set only
 * as an override still has to reach them.
 */
export function createEffectiveEndpoints(deps: {
  getBundled: () => EndpointsConfig | null;
  getOverrides: () => EndpointOverrides;
}): () => EndpointsConfig | null {
  return () => {
    const bundled = deps.getBundled();
    return bundled ? mergeEndpoints(bundled, deps.getOverrides()) : null;
  };
}

export function wireSpeakerSelection(deps: {
  /** Effective endpoints, or null while a best-effort config load has not finished. */
  getEndpoints: () => { tts_base_url?: string; tts_speaker?: string } | null;
  /** Resolves the TTS server key (Bearer). Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  log: Logger;
  broadcastSettings: () => void;
}): {
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Pick step: opens the file picker, returns the source path + a seed name for the naming row (null on cancel). */
  pickVoiceImport: () => Promise<{ srcPath: string; seedName: string } | null>;
  /** Commit step: copy + upload under `name` (overwrite-aware) → add option + select. */
  commitVoiceImport: (srcPath: string, name: string) => Promise<void>;
  removeVoice: (id: string) => Promise<void>;
  refreshVoiceList: () => Promise<void>;
} {
  const { getEndpoints, getApiKey, log, broadcastSettings } = deps;
  // Speaker selection store. Starts with an empty fallback since config is not loaded yet —
  // the panel is needed early. After config loads, refreshVoiceList injects the server-reported
  // voice list and default.
  const speakerSelection = createSpeakerSelection({
    defaultValue: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  // Voices are server-side persistent, so picking one is a store commit and nothing else.
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    speakerSelection.select(option.id);
  };
  // Re-upload the reference clip — server-side force-refresh only, does not change the selection.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const baseUrl = getEndpoints()?.tts_base_url;
    if (!baseUrl) throw new Error("voice refresh requires tts_base_url");
    const f = await selectFetch();
    await upsertVoice({
      baseUrl,
      id: option.id,
      refUrl: option.ref_url,
      fetch: f,
      getApiKey,
      logger: log,
    });
    // The clip behind an unchanged id was replaced — bump the persisted revision so every
    // window's filler cache key moves with it.
    const prev = speakerSelection.list().find((o) => o.id === option.id)?.revision ?? 0;
    speakerSelection.addUserOption({ ...option, source: "user", revision: prev + 1 });
  };
  const { pickVoiceImport, commitVoiceImport } = createVoiceImportFlow({
    getTtsBaseUrl: () => getEndpoints()?.tts_base_url,
    getApiKey,
    speakerSelection,
    log,
  });
  // Deletes the server-side voice; a user-imported one also drops its local clip.
  const removeVoice = async (id: string): Promise<void> => {
    const baseUrl = getEndpoints()?.tts_base_url;
    if (!baseUrl) throw new Error("voice delete requires tts_base_url");
    const f = await selectFetch();
    await deleteVoice({ baseUrl, id, fetch: f, getApiKey, logger: log });
    const source = speakerSelection.list().find((o) => o.id === id)?.source;
    if (source === "user") await removeUserVoiceFile(id);
  };
  // Announce cross-window so the speaker picked in this window reflects in the settings-window UI.
  speakerSelection.subscribe(broadcastSettings);
  // A fresh server with no voices yields a genuinely empty available[] — expected, not an error
  // (selection-store then has nothing to select).
  const refreshVoiceList = createVoiceListRefresh({
    getEndpoints,
    getApiKey,
    speakerSelection,
    reuploadUserVoice: refreshSpeaker,
    log,
  });
  return {
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    pickVoiceImport,
    commitVoiceImport,
    removeVoice,
    refreshVoiceList,
  };
}

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
 * Stop click → client-side cancel of the in-flight turn AND immediate speech abort.
 * cancel() alone leaves already-queued TTS segments playing: backend-caller's superseded
 * path defers speech cleanup to the next turn, which never comes on an explicit stop.
 */
export function wireStopControl(deps: {
  onStop: (cb: () => void) => void;
  cancel: () => void;
  abortSpeech: () => void;
}): void {
  deps.onStop(() => {
    deps.cancel();
    deps.abortSpeech();
  });
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
 * extras (pet's mouth-preview/voice channels and VRM hot-swap, the settings window's vrm/speaker
 * resync) layer on top through `extraResync` and `onRemoteChange`.
 */
export function wireWindowSync(deps: {
  stores: SettingsStores;
  windowKind: WindowKind;
  /** Stores that resync alongside the registry's reload set — storage event, remote change, and focus reload. */
  extraResync?: ReadonlyArray<{ reloadFromStorage(): void }>;
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
  const { stores, windowKind, extraResync, log } = deps;
  let disposed = false;
  const resyncStores = [...reloadSyncStores(stores), ...(extraResync ?? [])];
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
  } = createSettingsBroadcast({ bridge, syncedStores: broadcastSyncStores(stores) });
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

/**
 * Ambient floor walking. Tauri-only — a stroll moves the OS window, so in a plain browser
 * (Vite dev) this is skipped and bootstrap continues. The returned handle cancels a running
 * stroll for the owners that outrank ambient (user drag, agent command) and owns teardown.
 */
export function wireWalker(deps: {
  bus: EventBus;
  renderer: Renderer;
  getWalkConfig: () => WalkConfig;
  /** Registry kind of a motion id, for the "nothing else holds the body" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  isPeeking: () => boolean;
  isDragging: () => boolean;
  /** A turn is in flight or speech is still playing — ambient movement stays out of the way. */
  isBusy: () => boolean;
  /** Keep the hit-test cursor mapping accurate while the window translates. */
  setHitTestMoving: (moving: boolean) => void;
  log: Logger;
}): { cancel(): void; dispose(): void } {
  const { bus, renderer, log } = deps;
  let walker: Walker | null = null;
  let disposed = false;
  const handle = {
    cancel: () => walker?.cancel(),
    dispose: () => {
      disposed = true;
      walker?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    if (disposed) return;
    const push = (event_name: string): void => {
      bus.push({ source: "timer_scheduler", event_name, ts: Date.now(), hint_tier: 1 });
    };
    // Built once: a stroll asks for this handle on every frame it moves the window.
    const moveTo = new PhysicalPosition(0, 0);
    const walkerWindow: PetWindow = {
      outerPosition: () => getCurrentWindow().outerPosition(),
      outerSize: () => getCurrentWindow().outerSize(),
      scaleFactor: () => getCurrentWindow().scaleFactor(),
      setPositionPhysical: (x, y) => {
        moveTo.x = x;
        moveTo.y = y;
        return getCurrentWindow().setPosition(moveTo);
      },
    };
    walker = createWalker({
      renderer,
      getWindow: () => walkerWindow,
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getConfig: deps.getWalkConfig,
      currentMotionKind: () => {
        const current = renderer.getCurrentMotion();
        return current ? (deps.getMotionKind(current.id) ?? null) : null;
      },
      isPeeking: deps.isPeeking,
      isDragging: deps.isDragging,
      isBusy: deps.isBusy,
      onStart: () => {
        deps.setHitTestMoving(true);
        push("avatar.walk_start");
      },
      onEnd: () => {
        deps.setHitTestMoving(false);
        push("avatar.walk_end");
      },
    });
    walker.start();
  })().catch((err) => log.warn("walker_start_failed", { degrade: true, error: String(err) }));
  return handle;
}

/**
 * Falling. Tauri-only — a fall moves the OS window, so in a plain browser (Vite dev) this is
 * skipped and bootstrap continues. The returned handle triggers a fall from the drag-release
 * miss, cancels a running one for the user, and owns teardown.
 */
export function wireFaller(deps: {
  bus: EventBus;
  renderer: Renderer;
  getFallConfig: () => FallConfig;
  /** Registry kind of a motion id, for the "only the baseline hands the clip back" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  /** The walker's grounded tolerance — the same floor line decides "already down". */
  getFloorTolerancePx: () => number;
  getGestureCues: () => GestureCuesConfig;
  /** Keep the hit-test cursor mapping accurate while the window translates. */
  setHitTestMoving: (moving: boolean) => void;
  log: Logger;
}): { drop(): void; cancel(): void; dispose(): void } {
  const { bus, renderer, log } = deps;
  let faller: Faller | null = null;
  let disposed = false;
  const handle = {
    drop: () => void faller?.drop(),
    cancel: () => faller?.cancel(),
    dispose: () => {
      disposed = true;
      faller?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    if (disposed) return;
    // Built once: a fall asks for this handle on every frame it moves the window.
    const moveTo = new PhysicalPosition(0, 0);
    const fallerWindow: PetWindow = {
      outerPosition: () => getCurrentWindow().outerPosition(),
      outerSize: () => getCurrentWindow().outerSize(),
      scaleFactor: () => getCurrentWindow().scaleFactor(),
      setPositionPhysical: (x, y) => {
        moveTo.x = x;
        moveTo.y = y;
        return getCurrentWindow().setPosition(moveTo);
      },
    };
    faller = createFaller({
      renderer,
      getWindow: () => fallerWindow,
      currentMotionKind: () => {
        const current = renderer.getCurrentMotion();
        return current ? (deps.getMotionKind(current.id) ?? null) : null;
      },
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getConfig: deps.getFallConfig,
      getFloorTolerancePx: deps.getFloorTolerancePx,
      onStart: () => deps.setHitTestMoving(true),
      onEnd: () => deps.setHitTestMoving(false),
      onLand: (heightPx) => {
        bus.push({
          source: "os_event_watcher",
          event_name: "user.fall_land",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
          payload: { height_px: Math.round(heightPx) },
        });
      },
      onCue: (heightPx) => {
        const cue = deps.getGestureCues().dropped;
        bus.push({
          source: "os_event_watcher",
          event_name: "proactive.dropped",
          ts: Date.now(),
          hint_tier: 2,
          payload: {
            cue_id: "dropped",
            label: cue.label,
            ...(cue.context !== undefined ? { context: cue.context } : {}),
            height_px: Math.round(heightPx),
          },
        });
      },
    });
  })().catch((err) => log.warn("faller_start_failed", { degrade: true, error: String(err) }));
  return handle;
}

/**
 * Window-sit drop + ctrl+wheel resize producers, the agent loopback ingress bind, and the
 * avatar RPC executor that answers the ingress's `/avatar/*` bridge.
 * Tauri-only — getCurrentWindow()/invoke/listen require the Tauri runtime; in a plain browser
 * (Vite dev) this is skipped so bootstrap continues. The returned handle owns teardown and
 * forwards user-drag interruption once the asynchronous Tauri executor is ready.
 */
export function wireWindowSources(deps: {
  bus: EventBus;
  renderer: Renderer;
  peekActive: () => boolean;
  getPeekConfig: () => PeekConfig;
  getGestureCues: () => GestureCuesConfig;
  agentNotifySettings: { get(): AgentNotifySettings };
  /** Current physical posture, for the avatar RPC state answer. */
  getPosture: () => Posture;
  /** Currently loaded VRM, for the avatar RPC state answer. */
  getVrm: () => { id: string; label: string } | null;
  /** Record that the avatar just relocated on its own — a successful move_to restamps posture. */
  noteAvatarMoved: () => void;
  /** An agent command is taking the avatar — ambient motion yields to it. */
  noteAgentMove: () => void;
  /** A drag release that caught nothing — the character falls from where she hangs. */
  onDragMiss: () => void;
  log: Logger;
}): {
  noteUserDrag(): void;
  noteUserDragEnd(): void;
  dispose(): void;
} {
  const {
    bus,
    renderer,
    peekActive,
    getPeekConfig,
    getGestureCues,
    agentNotifySettings,
    getPosture,
    getVrm,
    noteAvatarMoved,
    noteAgentMove,
    log,
  } = deps;
  let windowDropSource: ReturnType<typeof createWindowDropSource> | null = null;
  let windowResizeSource: ReturnType<typeof createWindowResizeSource> | null = null;
  let avatarExecutor: AvatarExecutor | null = null;
  let disposed = false;
  const handle = {
    noteUserDrag: () => avatarExecutor?.noteUserDrag(),
    noteUserDragEnd: () => avatarExecutor?.noteUserDragEnd(),
    dispose: () => {
      disposed = true;
      windowDropSource?.stop();
      windowResizeSource?.stop();
      avatarExecutor?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Only bind loopback ingress when watcher on. Restart-to-apply:
    // toggling enable/port takes effect on next launch (no live rebind).
    if (agentNotifySettings.get().enabled) {
      void invoke("start_agent_ingress", { port: agentNotifySettings.get().port }).catch((e) =>
        log.warn("start_agent_ingress_failed", { error: String(e) }),
      );
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { listen } = await import("@tauri-apps/api/event");
    const { LogicalPosition, LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
    windowDropSource = createWindowDropSource({
      bus,
      renderer,
      invoke: (cmd) => invoke(cmd) as Promise<WindowRect[]>,
      // Position setter included: the programmatic placement path moves the window
      // itself, so the drop source owns both halves of the perch geometry.
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          scaleFactor: () => win.scaleFactor(),
          setPositionPhysical: (x, y) => win.setPosition(new PhysicalPosition(x, y)),
        };
      },
      listen: listen as never,
      peekActive,
      getPeekConfig,
      getGestureCues,
      onDragMiss: deps.onDragMiss,
    });
    windowResizeSource = createWindowResizeSource({
      renderer,
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          outerSize: () => win.outerSize(),
          scaleFactor: () => win.scaleFactor(),
          async setBoundsLogical(pos, size) {
            await win.setSize(new LogicalSize(size.width, size.height));
            await win.setPosition(new LogicalPosition(pos.x, pos.y));
          },
        };
      },
    });
    // Avatar RPC: the loopback ingress bridges `/avatar/*` here, where the state
    // lives and the movement happens. Perch gestures go through the drop source's
    // placement so they share the drag flow's geometry, arming and envelopes.
    const { availableMonitors } = await import("@tauri-apps/api/window");
    avatarExecutor = createAvatarExecutor({
      subscribe: (cb) => onAvatarRpc(cb),
      respond: (id, result) => void respondAvatarRpc(id, result),
      perch: windowDropSource,
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          outerSize: () => win.outerSize(),
          scaleFactor: () => win.scaleFactor(),
          setPositionPhysical: (x, y) => win.setPosition(new PhysicalPosition(x, y)),
        };
      },
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getFeetOffsetPx: () => renderer.getCharacterAnchor()?.y ?? null,
      getPosture,
      getVrm,
      noteAvatarMoved,
      noteAgentMove,
    });
    if (disposed) {
      windowDropSource.stop();
      return;
    }
    await windowDropSource.start();
    if (disposed) {
      windowDropSource.stop();
      return;
    }
    windowResizeSource.start();
    avatarExecutor.start();
  })().catch((err) =>
    log.warn("window_drop_source_start_failed", {
      degrade: true,
      error: String(err),
    }),
  );
  return handle;
}

/** The busy predicate a buffered-inbox source takes: the pipeline's own, plus the global gap. */
export interface PacedPipelineBusy {
  isBusy: () => boolean;
  subscribe: (cb: (busy: boolean) => void) => () => void;
}

/**
 * Compose pipeline-busy with the global proactive gap. The buffered-inbox sources hold their
 * items instead of skipping them, so a held window reads as busy and its opening is the
 * busy→idle edge that flushes one catchup.
 */
export function composePacedPipelineBusy(deps: {
  pipelineBusy: PacedPipelineBusy;
  pacer: Pick<ProactivePacer, "isHolding" | "subscribe">;
}): PacedPipelineBusy {
  const { pipelineBusy, pacer } = deps;
  const paced: PacedPipelineBusy = {
    isBusy: () => pipelineBusy.isBusy() || pacer.isHolding(),
    subscribe: (cb) => {
      const unsubscribeBusy = pipelineBusy.subscribe(() => cb(paced.isBusy()));
      const unsubscribePacer = pacer.subscribe(() => cb(paced.isBusy()));
      return () => {
        unsubscribeBusy();
        unsubscribePacer();
      };
    },
  };
  return paced;
}

/**
 * tier2 utterance candidate sources: proactive.<id> (idle dramatization) + schedule.<id>
 * (time-of-day greeting) + agent.done/needs_input/catchup + signals.push/batch/catchup, all over the
 * presence gate.
 * Created and started; the started refs are returned for interaction-notes and teardown.
 */
export function wireDispatcherSources(deps: {
  bus: EventBus;
  presenceSettings: Pick<ClampedIntSettingsStore, "get">;
  proactiveSettings: { get(): ProactiveSettings };
  scheduleSettings: { get(): ScheduleSettings };
  agentNotifySettings: { get(): AgentNotifySettings };
  screenSettings: { get(): { enabled: boolean } };
  getScreenConfig: () => ScreenConfig;
  /** Dispatcher in-flight busy edges — anchors the screen source's quiet-after-turn window. */
  subscribeBusy: (cb: (busy: boolean) => void) => () => void;
  pipelineBusy: PacedPipelineBusy;
  /** Global proactive gap — a hold reads as a skip to the screen source and as busy to the inboxes. */
  pacer: Pick<ProactivePacer, "isHolding" | "subscribe">;
}): {
  proactiveSource: ProactiveSource;
  scheduleSource: ScheduleSource;
  agentSource: ReturnType<typeof createAgentSource>;
  signalsSource: SignalsSource;
  screenSource: ScreenSource;
} {
  const {
    bus,
    presenceSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    screenSettings,
    getScreenConfig,
    subscribeBusy,
    pipelineBusy,
    pacer,
  } = deps;
  const pacedPipelineBusy = composePacedPipelineBusy({ pipelineBusy, pacer });
  const proactiveSource = createProactiveSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getCues: () => proactiveSettings.get().entries,
    isEnabled: () => proactiveSettings.get().enabled,
  });
  void proactiveSource.start();
  const scheduleSource = createScheduleSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getCues: () => scheduleSettings.get().entries,
    isEnabled: () => scheduleSettings.get().enabled,
  });
  void scheduleSource.start();
  const agentSource = createAgentSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
  });
  void agentSource.start();
  const signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
  });
  void signalsSource.start();
  const screenSource = createScreenSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getConfig: getScreenConfig,
    isEnabled: () => screenSettings.get().enabled,
    noteInteraction: proactiveSource.noteInteraction,
    subscribeBusy,
    isPacerHolding: pacer.isHolding,
    appendSkipRecord: (record) => appendRecord(record),
  });
  void screenSource.start();
  return { proactiveSource, scheduleSource, agentSource, signalsSource, screenSource };
}

export async function wirePeekExitTriggers(deps: {
  bus: EventBus;
  peek: { active(): boolean; exit(): Promise<void> };
  win: {
    onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<() => void>;
    listen(event: "tray_toggle", handler: () => void): Promise<() => void>;
  };
}): Promise<() => void> {
  const exitPeek = async (): Promise<void> => {
    if (!deps.peek.active()) return;
    await deps.peek.exit();
    deps.bus.push({
      source: "os_event_watcher",
      event_name: "user.peek_exit",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
    });
  };
  const unlistenFocus = await deps.win.onFocusChanged((event) => {
    if (event.payload) void exitPeek();
  });
  let unlistenTray: (() => void) | undefined;
  try {
    unlistenTray = await deps.win.listen("tray_toggle", () => void exitPeek());
  } catch (error) {
    unlistenFocus();
    throw error;
  }
  return () => {
    unlistenFocus();
    unlistenTray?.();
  };
}

export async function showAndFocusFromSummon(deps: {
  bus: EventBus;
  peek: { active(): boolean; exit(): Promise<void> };
  win: { show(): Promise<void>; setFocus(): Promise<void> };
}): Promise<void> {
  await deps.win.show();
  if (deps.peek.active()) {
    await deps.peek.exit();
    deps.bus.push({
      source: "user_input_source",
      event_name: "user.peek_exit",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
    });
  }
  await deps.win.setFocus();
}

/**
 * Global summon hotkey (Tauri-only — skipped in browser dev). Registers the configured
 * accelerator OS-globally; on fire, show+focus the window then summon input. Registration
 * failure fails soft (summon-hotkey warns, treats as inactive). The returned handle remains
 * stable while the asynchronous Tauri implementation initializes.
 */
export function wireSummonHotkey(deps: {
  surfaces: Pick<Surfaces, "summonInput" | "isInputOpen">;
  bus: EventBus;
  peek: { active(): boolean; exit(): Promise<void> };
  accelerator: string;
  /** The accelerator failed to register after every retry (OS/another app holds it). */
  onRegisterFailed?: (accelerator: string) => void;
  log: Logger;
}): SummonHotkey {
  const { surfaces, accelerator, log, bus, peek } = deps;
  let summonHotkey: SummonHotkey | null = null;
  let desiredAccelerator = accelerator;
  let disposed = false;
  const handle: SummonHotkey = {
    apply(next) {
      desiredAccelerator = next;
      return summonHotkey?.apply(next) ?? Promise.resolve();
    },
    current: () => summonHotkey?.current() ?? null,
    async dispose() {
      disposed = true;
      await summonHotkey?.dispose();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    summonHotkey = createSummonHotkey({
      register,
      unregister,
      // On macOS, include background app activation, bring forward (show before hidden).
      focusWindow: async () => {
        await showAndFocusFromSummon({ win: getCurrentWindow(), peek, bus });
      },
      summonInput: () => surfaces.summonInput(),
      isInputOpen: () => surfaces.isInputOpen(),
      ...(deps.onRegisterFailed ? { onRegisterFailed: deps.onRegisterFailed } : {}),
    });
    if (disposed) return void summonHotkey.dispose();
    await summonHotkey.apply(desiredAccelerator);
  })().catch((err) => log.warn("summon_hotkey_wire_failed", { error: String(err) }));
  return handle;
}

/**
 * Expression Broker publish (D6). Resolves the CORS-bypass fetch once, does the fire-and-forget
 * initial publish when broker_base_url is present (never blocks boot), and wires the override
 * reconciler so a live broker-URL edit retargets the client. `onConfigChange` is
 * called from the caller's config.subscribe to re-publish on disk edits that change renderable
 * vocab; effective (override-merged) endpoints are used so disk edits don't clobber user overrides.
 */
export async function wireBroker(deps: {
  getConfig: () => AppConfig;
  getEndpoints: () => EndpointsConfig;
  endpointsSettings: { subscribe(cb: () => void): () => void };
  /** Curates the published motion vocabulary; a change re-publishes it. */
  expressMotionSettings: {
    get(): ExpressMotionSettings;
    subscribe(cb: () => void): () => void;
  };
  log: Logger;
}): Promise<{
  onConfigChange: (cfg: AppConfig, changed: ReadonlySet<ConfigSection>) => void;
  /** Renderable vocabulary as published, for consumers that declare it themselves (CC client tools). */
  vocabulary: () => BrokerPayload;
  dispose: () => void;
}> {
  const { getConfig, getEndpoints, endpointsSettings, expressMotionSettings, log } = deps;
  // In the Tauri webview the broker (localhost:3201) is cross-origin → inject the CORS-bypass fetch.
  // Resolved once and reused when the client is retargeted.
  const brokerFetch = (await selectFetch()) ?? undefined;
  let broker: BrokerClient | null = null;
  const makeBroker = (baseUrl: string): BrokerClient =>
    createBrokerClient({ baseUrl, ...(brokerFetch ? { fetch: brokerFetch } : {}) });
  // Latest emotion_text table, kept current by every load so vocabulary() reflects it.
  let table: Record<string, string> | null = null;
  // Best-effort load of the emoji enum table; on failure the broker degrades to free mode.
  const loadBrokerTable = async (): Promise<Record<string, string> | null> => {
    try {
      table = await loadEmotionTextTable({ provider: "irodori" });
    } catch (err) {
      log.warn("emotion_text_load_failed", { fallback: "free", error: String(err) });
      table = null;
    }
    return table;
  };
  /** Every payload goes through here, so the motion selection reaches publish and tools alike. */
  const derive = (
    cfg: AppConfig,
    eff: EndpointsConfig,
    emotionTable: Record<string, string> | null,
  ): BrokerPayload =>
    deriveBrokerPayload({ ...cfg, endpoints: eff }, emotionTable, {
      expressMotions: expressMotionSettings.get(),
    });
  const vocabulary = (): BrokerPayload => derive(getConfig(), getEndpoints(), table);

  const bootEps = getEndpoints();
  // Loaded even with no broker: the vocabulary also feeds the client-declared tools.
  const bootTable = await loadBrokerTable();
  if (bootEps.broker_base_url) {
    broker = makeBroker(bootEps.broker_base_url);
    const payload = derive(getConfig(), bootEps, bootTable);
    void broker.publish(payload).then(() => broker?.start());
  } else {
    log.debug("broker_disabled", { reason: "no_broker_base_url" });
  }

  const reconciler = createBrokerOverrideReconciler({
    getEffectiveEndpoints: getEndpoints,
    getBroker: () => broker,
    setBroker: (b) => {
      broker = b;
    },
    createBroker: makeBroker,
    loadTable: loadBrokerTable,
    derivePayload: (eff, table) => derive(getConfig(), eff, table),
  });
  const unsubscribeOverride = endpointsSettings.subscribe(() => {
    void reconciler.onChange();
  });
  // The selection is broadcast-synced, so this fires for the settings window's edit too.
  const unsubscribeExpressMotions = expressMotionSettings.subscribe(() => {
    if (broker) void broker.publish(vocabulary());
  });

  const onConfigChange = (cfg: AppConfig, changed: ReadonlySet<ConfigSection>): void => {
    if (
      broker &&
      (changed.has("emotionRegistry") || changed.has("motions") || changed.has("endpoints"))
    ) {
      const eff = getEndpoints();
      void loadBrokerTable().then((loaded) => {
        void broker?.publish(derive(cfg, eff, loaded));
      });
    }
  };

  const dispose = (): void => {
    unsubscribeOverride();
    unsubscribeExpressMotions();
    broker?.dispose();
  };

  return { onConfigChange, vocabulary, dispose };
}

/**
 * STT/VAD voice-input lifecycle: start/stop driven by the voiceInputStatus store, on/off intent
 * persisted to sttSettings for next-run auto-resume, and the STT engine bound post-config via setStt
 * (which also auto-resumes if voice was left on last session). The engine's submit/barge-in callbacks
 * are wired at the createSttVad call site, not here — this seam only owns the lifecycle.
 */
export function wireVoiceInput(deps: {
  voiceInputStatus: VoiceInputStatus;
  sttSettings: { get(): { enabled: boolean }; setEnabled(enabled: boolean): void };
}): {
  setStt: (stt: SttVad) => void;
  dispose: () => void;
} {
  const { voiceInputStatus, sttSettings } = deps;
  let sttVad: SttVad | null = null;
  let ready = false;
  let startRequested = false;

  async function startVoiceInput(): Promise<void> {
    startRequested = true;
    if (!ready || !sttVad) return;
    try {
      await sttVad.start();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Voice input failed";
      voiceInputStatus.set("error", detail);
    }
  }
  function stopVoiceInput(): void {
    startRequested = false;
    sttVad?.stop();
  }
  const unsubscribeStatus = voiceInputStatus.subscribe((snapshot) => {
    if (snapshot.state === "idle") {
      stopVoiceInput();
      return;
    }
    if (snapshot.state === "listening") {
      void startVoiceInput();
    }
  });
  // Persist voice input on/off intent — enabled if not idle. Used for auto-resume on next run.
  const unsubscribePersist = voiceInputStatus.subscribe((snapshot) => {
    sttSettings.setEnabled(snapshot.state !== "idle");
  });
  // Bind the STT engine once config is loaded; mark ready then auto-resume if left on last session.
  const setStt = (stt: SttVad): void => {
    sttVad = stt;
    ready = true;
    if (startRequested || voiceInputStatus.get().state !== "idle" || sttSettings.get().enabled) {
      void startVoiceInput();
    }
  };
  const dispose = (): void => {
    unsubscribeStatus();
    unsubscribePersist();
    void sttVad?.dispose();
  };
  return { setStt, dispose };
}

/**
 * Pet-window cross-window sync: the shared core plus the channels only this window owns — mouth
 * preview and the voice toggle/state pair, which ride the same bridge. `broadcastSettings` goes to
 * the VRM/speaker selections and `onRemoteChange` to `wireSettingsReload`, both wired by the caller
 * once those selections exist.
 */
export function wireCrossWindowSync(deps: {
  renderer: Pick<Renderer, "setMouthOpen" | "stopMouth">;
  voiceInputStatus: VoiceInputStatus;
  stores: SettingsStores;
  log: Logger;
}): {
  broadcastSettings: () => void;
  onRemoteChange: (cb: () => void) => void;
  dispose: () => void;
} {
  const { renderer, voiceInputStatus, stores, log } = deps;
  const core = wireWindowSync({ stores, windowKind: "pet", log });
  // Mouth preview (separate window → this window VRM): gain slider drag moves actual mouth.
  core.bridge.onMouthPreview((mouthOpen) => {
    if (mouthOpen == null) renderer.stopMouth();
    else renderer.setMouthOpen(mouthOpen);
  });
  // Voice toggle (separate window → this window STT): existing voiceInputStatus subscription starts/stops sttVad.
  core.bridge.onVoiceSet((on) => {
    log.info("voice_toggle_received", { on, source: "settings_window" });
    voiceInputStatus.set(on ? "listening" : "idle");
  });
  // Voice state (this window → separate window): separate window indicator reflects actual STT state.
  voiceInputStatus.subscribe((snapshot) => {
    core.bridge.emitVoiceState({ state: snapshot.state });
  });
  return {
    broadcastSettings: core.broadcastSettings,
    onRemoteChange: core.onRemoteChange,
    dispose: core.dispose,
  };
}

/**
 * Settings-window cross-window sync. Unlike the pet window, the VRM and speaker selections resync
 * here too — this window commits them store-only, so it has to pick up the pet window's picks.
 */
export function wireSettingsWindowSync(deps: {
  stores: SettingsStores;
  vrmSelection: { reloadFromStorage(): void };
  speakerSelection: { reloadFromStorage(): void };
  log: Logger;
}): {
  bridge: SettingsBridge;
  broadcastSettings: () => void;
  reload: () => void;
  dispose: () => void;
} {
  const { stores, vrmSelection, speakerSelection, log } = deps;
  const { bridge, broadcastSettings, reload, dispose } = wireWindowSync({
    stores,
    windowKind: "settings",
    extraResync: [vrmSelection, speakerSelection],
    log,
  });
  return { bridge, broadcastSettings, reload, dispose };
}

/** Devtools-window cross-window sync — the shared core with no window-specific extras. */
export function wireDevtoolsSync(deps: { stores: SettingsStores; log: Logger }): {
  reload: () => void;
  dispose: () => void;
} {
  const { reload, dispose } = wireWindowSync({
    stores: deps.stores,
    windowKind: "devtools",
    log: deps.log,
  });
  return { reload, dispose };
}

/**
 * DEV-only console/global handles for the screenshot validation loop and manual exploration:
 * `__yuiRenderer`/`__yuiSurfaces`/etc for direct inspection, `__yui_send`/`__yui_windowSit`/`__yuiDemo`
 * for firing dispatcher-spine events without a real gesture. Never runs in production builds.
 */
export async function wireDevGlobals(deps: {
  renderer: Renderer;
  ambient: Pick<Tier1Engine, "trigger">;
  surfaces: Surfaces;
  screenshotSettings: unknown;
  lipsyncSettings: unknown;
  agentSettings: unknown;
  quickControls: unknown;
  voiceInputStatus: VoiceInputStatus;
  userInput: Pick<UserInputSource, "submit">;
  bus: EventBus;
  getDispatcher: () => Dispatcher | null;
}): Promise<void> {
  const {
    renderer,
    ambient,
    surfaces,
    screenshotSettings,
    lipsyncSettings,
    agentSettings,
    quickControls,
    voiceInputStatus,
    userInput,
    bus,
    getDispatcher,
  } = deps;
  const { createMockDriver } = await import("./ui/mock");
  const mock: ReturnType<typeof createMockDriver> = createMockDriver(surfaces);
  Object.assign(globalThis as Record<string, unknown>, {
    __yuiRenderer: renderer,
    __yuiAmbient: ambient,
    __yuiSurfaces: surfaces,
    __yuiMock: mock,
    __yuiScreenshot: screenshotSettings,
    __yuiLipsync: lipsyncSettings,
    __yuiAgent: agentSettings,
    __yuiQuick: quickControls,
    __yuiVoiceInputStatus: voiceInputStatus,
    // DEV-ONLY trigger: fire E2E loop directly from console.
    //   window.__yui_send("hello") → user.text_submitted → dispatcher → backend_caller →
    //   streamChat → Hermes → ControlEnvelope → renderer.applyDirective + bubble.
    // Temporary handle for validation.
    __yui_send: (text: string) => userInput.submit(text),
    // Dispatcher observation: __yui_dispatcher.inFlight()/queue()/recentDrops().
    __yui_dispatcher: getDispatcher,
    // DEV-ONLY trigger: fire window_sit perch enter/exit/drop directly from console.
    //   window.__yui_windowSit.enter() → user.window_sit_enter → dispatcher → renderer.
    //   window.__yui_windowSit.drop(rect) → user.window_sit_drop(geometry) → perch align.
    __yui_windowSit: {
      enter: () =>
        bus.push({
          source: "user_input_source",
          event_name: "user.window_sit_enter",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        }),
      exit: () =>
        bus.push({
          source: "user_input_source",
          event_name: "user.window_sit_exit",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        }),
      // Compute edge_local_ypx from current window outerPosition/scaleFactor,
      // drive geometry path without real OS window (Tauri: actual values, else 0,0/1 fallback).
      drop: async (rect: WindowRect): Promise<void> => {
        let pos = { x: 0, y: 0 };
        let scale = 1;
        if (isTauri()) {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const w = getCurrentWindow();
            pos = await w.outerPosition();
            scale = await w.scaleFactor();
          } catch {
            /* fallback to 0,0 / 1 */
          }
        }
        const sf = scale > 0 ? scale : 1;
        bus.push({
          source: "os_event_watcher",
          event_name: "user.window_sit_drop",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
          payload: {
            edge_local_ypx: rect.y - pos.y / sf,
          },
        });
      },
      // Occupancy simulation: fire occlusion poll exit result (window_sit_exit) without real second window.
      occlude: (_rect?: WindowRect) =>
        bus.push({
          source: "os_event_watcher",
          event_name: "user.window_sit_exit",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        }),
    },
    // Step-by-step demo helpers
    __yuiDemo: {
      input: () => surfaces.summonInput(),
      tool: (id = "web_search") => surfaces.showTool(id),
      send: (text = "안녕") => userInput.submit(text),
      reply: (text = "오늘 일정 뭐 있어?") => mock.reply(text),
      proactive: () => mock.proactive(),
      speak: (line = "응, 듣고 있어. 그거 지금 같이 볼까?") => mock.speak(line),
      tap: () => ambient.trigger("tap_react"),
      idleReturn: () => ambient.trigger("idle_returned"),
    },
  });
}
