/**
 * YUI bootstrap.
 *
 * Graph:
 *   loadConfig() → createRenderer(mount) → createTier1Engine(renderer)
 *               → createEventBus() + createGuardrails()
 *               → createDispatcher({ bus, guardrails, renderer })
 *               → subscribe sources(timer/idle/user_input + Rust os_event) → dispatcher.start()
 *   io: streamChat(SSE) → express + text stream → renderer / surfaces / tts-pipeline.
 *
 *   - .yui-stage: transparent character stage (drag region). renderer fills with canvas.
 *   - .yui-ui:    overlay — speech bubble, tool state, text input (invisible-by-default).
 */

import "./styles.css";
import { createTier1Engine } from "./ambient/tier1";
import { wireSpeakerSelection, wireVrmSelection } from "./bootstrap-wiring";
import {
  CHAT_API_KEY_SECRET,
  createConfigStore,
  loadEmotionTextTable,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "./config";
import type { WindowRect } from "./contract";
import { createAgentSource } from "./dispatcher/agent-source";
import { createBackendCaller } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import { createEventBus } from "./dispatcher/event-bus";
import { createGuardrails, type Guardrails } from "./dispatcher/guardrails";
import { createProactiveSource } from "./dispatcher/proactive-source";
import { createScheduleSource } from "./dispatcher/schedule-source";
import { createSignalsSource } from "./dispatcher/signals-source";
import { createUserInputSource } from "./dispatcher/user-input-source";
import { initDrag } from "./drag";
import { resolveAssetUrl } from "./io/asset-url";
import { createWebAudioSink } from "./io/audio-player";
import { type BrokerClient, createBrokerClient, deriveBrokerPayload } from "./io/broker-client";
import { createBrokerOverrideReconciler } from "./io/broker-override-reconciler";
import {
  CAMERA_ORBIT_SENSITIVITY,
  CAMERA_WHEEL_SENSITIVITY,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
} from "./io/camera-settings";
import { selectFetch } from "./io/chat-client";
import { mergeEndpoints } from "./io/endpoints-settings";
import { createFillerLoop } from "./io/filler-loop";
import { effectiveFillerPool } from "./io/filler-pool";
import { createHitTestController, type HitTestController } from "./io/hit-test";
import { createIrodoriSynth, type TtsSynth } from "./io/irodori-synth";
import { createIrodoriSynthFactory } from "./io/irodori-synth-factory";
import { ensureRegistered, evictRegistration } from "./io/irodori-voices";
import { createOsContext } from "./io/os-context";
import { buildScreenshotBlock } from "./io/screenshot-context";
import { createSettingsSecretProvider } from "./io/secret-provider";
import { createSettingsBridge } from "./io/settings-bridge";
import { createSettingsStores } from "./io/settings-stores";
import { createSettingsWindowOpener, wireStorageSync } from "./io/settings-window";
import { createSpeechPlayback } from "./io/speech-playback";
import type { SttVad } from "./io/stt-vad";
import { createSummonHotkey, type SummonHotkey } from "./io/summon-hotkey";
import { isTauri } from "./io/tauri-env";
import { resolveScreenCapturer, resolveScreenSourceProvider } from "./io/tauri-screen";
import { TTS_SKIP } from "./io/tts-pipeline";
import { createTtsSynth } from "./io/tts-synth";
import { removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { removeUserVrm } from "./io/vrm-import";
import { createWindowDropSource } from "./io/window-drop-source";
import { createWindowResizeSource } from "./io/window-resize-source";
import { createLogger, initLogger } from "./logger";
import { createRenderer } from "./renderer";
import { nextZoom } from "./renderer/camera-fit";
import {
  INPUT_ANCHOR_EPSILON_PX,
  INPUT_ANCHOR_MIN_BOTTOM_PX,
  INPUT_FEET_GAP_PX,
  inputBottomFromAnchor,
} from "./ui/anchor";
import { showBootError } from "./ui/boot-error";
import { createCaptureIndicator } from "./ui/capture-indicator";
import { maybeShowFirstRunHint } from "./ui/first-run-hint";
import {
  reloadFromStorage as reloadLocaleFromStorage,
  subscribe as subscribeLocale,
  t,
} from "./ui/i18n";
import { createQuickControls } from "./ui/quick-controls";
import { createSurfaces } from "./ui/surfaces";
import { routeTurnFailure, turnErrorMessage } from "./ui/turn-error";
import { createVoiceInputIndicator } from "./ui/voice-input-indicator";
import { createVoiceInputStatus } from "./ui/voice-input-status";

/** Input summon hotkey (window-focus only — global shortcuts to follow via tauri-plugin-global-shortcut). */
const SUMMON_KEY = "/";

/** Duration to hold voice-input-indicator backend-turn-failure "error" display(ms) — then return to listening. */
const VOICE_TURN_ERROR_DISPLAY_MS = 3_000;

const log = createLogger("bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // Root (positioning context) > stage (drag) + overlay (surfaces).
  // Stage = drag, overlay = pointer passthrough (input only exception).
  // Drag is handled via initDrag — gesture-stub seam allows per-region filtering.
  app.innerHTML = `
    <div class="yui-root">
      <div class="yui-stage"></div>
    </div>
  `;
  const root = app.querySelector<HTMLDivElement>(".yui-root")!;
  const stage = root.querySelector<HTMLDivElement>(".yui-stage")!;

  // Drag: a primary press that crosses the move threshold → OS-native drag via
  // Tauri IPC + a tier1 user.drag_start onto the bus (plays the drag motion,
  // clears any stale perch). onScaleChanged listener installed inside for DPI seam.
  // Click-through hit-test controller — late-bound (created after config load so
  // it gets the hit_test knob). Drag suspends toggling so the OS-native drag is
  // never interrupted by a mid-gesture ignore flip.
  let hitTestRef: HitTestController | null = null;
  const cleanupDrag = await initDrag(stage, {
    onDragStart: () => {
      hitTestRef?.suspend();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_start",
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
      });
    },
    onDragEnd: () => hitTestRef?.resume(),
    onOrbitStart: () => hitTestRef?.suspend(),
    onOrbitEnd: () => hitTestRef?.resume(),
    // Shift + left-drag orbits the camera. dx → azimuth, dy → polar; clamp/persist
    // live in cameraSettings, which drives renderer.setOrbit via the subscription below.
    onOrbit: ({ dx, dy }) => {
      const cur = cameraSettings.get();
      cameraSettings.setAzimuth(cur.azimuth + dx * CAMERA_ORBIT_SENSITIVITY);
      cameraSettings.setPolar(cur.polar - dy * CAMERA_ORBIT_SENSITIVITY);
    },
  });

  // Character scale via mouse wheel: clamp bounds and sensitivity are io constants, persist is owned by store.
  // Drag uses pointerdown only, so no conflict with wheel (drag.ts).
  const onWheelZoom = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // ctrl+wheel is window-resize gesture (window-resize-source).
    e.preventDefault();
    const next = nextZoom(cameraSettings.get().zoom, e.deltaY, {
      min: CAMERA_ZOOM_MIN,
      max: CAMERA_ZOOM_MAX,
      sensitivity: CAMERA_WHEEL_SENSITIVITY,
    });
    cameraSettings.setZoom(next);
  };
  stage.addEventListener("wheel", onWheelZoom, { passive: false });

  // Register drag + wheel cleanup on HMR dispose in dev.
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => {
      cleanupDrag();
      stage.removeEventListener("wheel", onWheelZoom);
    });
  }

  const renderer = createRenderer({ mount: stage });
  // Tier 1 ambient: backend-independent, always on. tick fires after VRM loads, so
  // starting before loadVRM is safe (frames without VRM are no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  const surfaces = createSurfaces({ mount: root });

  // Anchor chat input to character's feet (follow reframe). Each frame, receive feet screen coordinates,
  // map to input bottom offset, skip changes below epsilon to reduce var rewrites.
  let lastInputBottom: number | null = null;
  const unsubAnchor = renderer.onTick(() => {
    const a = renderer.getCharacterAnchor();
    if (!a) {
      if (lastInputBottom !== null) {
        surfaces.setInputAnchor(null);
        lastInputBottom = null;
      }
      return;
    }
    const bottom = inputBottomFromAnchor(a.y, stage.clientHeight || 1, {
      gap: INPUT_FEET_GAP_PX,
      minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX,
    });
    if (lastInputBottom === null || Math.abs(bottom - lastInputBottom) > INPUT_ANCHOR_EPSILON_PX) {
      surfaces.setInputAnchor(bottom);
      lastInputBottom = bottom;
    }
  });

  const {
    screenshotSettings,
    ttsSettings,
    sttSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
    lipsyncSettings,
    vadSettings,
    agentSettings,
    fillerSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    hintSettings,
    railCollapsedSettings,
  } = createSettingsStores();
  // Effective endpoints with overrides layered on config.endpoints. Evaluated at call time (hot-reload friendly).
  function getEndpoints(): ReturnType<typeof config.get>["endpoints"] {
    return mergeEndpoints(config.get().endpoints, endpointsSettings.get());
  }
  // Camera zoom: apply persisted zoom ratio at boot, flow to renderer on each change (wheel/cross-window).
  renderer.setZoom(cameraSettings.get().zoom);
  renderer.setOrbit({ azimuth: cameraSettings.get().azimuth, polar: cameraSettings.get().polar });
  cameraSettings.subscribe((s) => {
    renderer.setZoom(s.zoom);
    renderer.setOrbit({ azimuth: s.azimuth, polar: s.polar });
  });
  renderer.setIdleThrottleEnabled(idleThrottleSettings.get().enabled);
  idleThrottleSettings.subscribe((s) => renderer.setIdleThrottleEnabled(s.enabled));
  // Camera gaze on/off. Default on. Flow to renderer on each change (toggle/cross-window).
  renderer.setGazeEnabled(gazeSettings.get().enabled);
  gazeSettings.subscribe((s) => renderer.setGazeEnabled(s.enabled));
  const voiceInputStatus = createVoiceInputStatus();
  const screenSourceProvider = resolveScreenSourceProvider();
  const screenCapturer = resolveScreenCapturer();
  // Foreground app/title snapshot — backend_caller attaches as env to each request. Non-Tauri is no-op.
  const osContext = createOsContext({
    maxRecentApps: () => recentAppsSettings.get().recent_apps_max,
  });
  void osContext.start();
  // Pop-out: Tauri uses separate WebviewWindow("settings"), otherwise browser window. Wire storage events
  // bidirectionally so main window edits are reflected here and vice versa.
  const openSettings = createSettingsWindowOpener();
  const disposeStorageSync = wireStorageSync([
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    screenshotSettings,
    proactiveSettings,
    idleThrottleSettings,
    gazeSettings,
    ttsSettings,
    cameraSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    railCollapsedSettings,
  ]);

  // Real-time wiring with pop-out settings window (Tauri events). Make controls in separate window
  // reach live systems in this window (VRM renderer, STT/VAD). Storage fallback maintained above via wireStorageSync.
  const bridge = createSettingsBridge();
  // Mouth preview (separate window → this window VRM): gain slider drag moves actual mouth.
  bridge.onMouthPreview((mouthOpen) => {
    if (mouthOpen == null) renderer.stopMouth();
    else renderer.setMouthOpen(mouthOpen);
  });
  // Voice toggle (separate window → this window STT): existing voiceInputStatus subscription starts/stops sttVad.
  bridge.onVoiceSet((on) => {
    log.info("voice_toggle_received", { on, source: "settings_window" });
    voiceInputStatus.set(on ? "listening" : "idle");
  });
  // Voice state (this window → separate window): separate window indicator reflects actual STT state.
  voiceInputStatus.subscribe((snapshot) => {
    bridge.emitVoiceState({ state: snapshot.state });
  });
  // Persist voice input on/off intent — enabled if not idle. Used for auto-resume on next run.
  const unsubscribeSttPersist = voiceInputStatus.subscribe((snapshot) => {
    sttSettings.setEnabled(snapshot.state !== "idle");
  });
  // Settings sync (bidirectional, loop-guarded): one side edits → emit → other side reloads.
  // Store is no-op if values stay same, so round-trip terminates.
  // Debounce: consolidate slider drag/typing bursts into single cross-window event after 200ms idle.
  let applyingRemote = false;
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcastSettings = (): void => {
    if (applyingRemote) return;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      bridge.emitSettingsChanged();
    }, 200);
  };
  // Settings stores that broadcast/reload identically. cameraSettings excluded from array
  // since reload propagates to zoom, noted separately.
  type SyncedStore = {
    subscribe(cb: () => void): () => void;
    reloadFromStorage(): void;
  };
  const syncedSettingsStores: SyncedStore[] = [
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    screenshotSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
    idleThrottleSettings,
    ttsSettings,
  ];
  for (const store of syncedSettingsStores) store.subscribe(broadcastSettings);
  cameraSettings.subscribe(broadcastSettings);
  // Display language also syncs cross-window: broadcast changes, reapply from storage on remote change.
  subscribeLocale(broadcastSettings);
  bridge.onSettingsChanged(() => {
    applyingRemote = true;
    try {
      for (const store of syncedSettingsStores) store.reloadFromStorage();
      // Zoom reload → cameraSettings.subscribe(s => renderer.setZoom) propagates to camera.
      cameraSettings.reloadFromStorage();
      // Reflect display language changed in other window → i18n.subscribe remount callback redraws UI.
      reloadLocaleFromStorage();
      // VRM selection is committed store-only in settings window, reflect that change to pet window renderer.
      // This window's own swap is already loaded by swapVrm, so only OTHER window changes here → avoid double-load.
      const prevVrmUrl = vrmSelection.getActive().url;
      vrmSelection.reloadFromStorage();
      const nextVrmUrl = vrmSelection.getActive().url;
      if (nextVrmUrl !== prevVrmUrl) {
        void loadVrmSerialized(nextVrmUrl).catch((err) =>
          log.error("vrm_cross_window_swap_failed", { error: String(err) }),
        );
      }
      // Speaker selection is store-only — synth reads via getActive() on next utterance, so just reload.
      speakerSelection.reloadFromStorage();
    } finally {
      applyingRemote = false;
    }
    log.info("settings_change_received", { source: "settings_window" });
  });
  const { vrmSelection, loadVrmSerialized, swapVrm, importVrm } = wireVrmSelection({
    renderer,
    log,
    broadcastSettings,
  });

  const { speakerSelection, swapSpeaker, refreshSpeaker, importVoice } = wireSpeakerSelection({
    getEndpoints,
    log,
    broadcastSettings,
  });

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: root,
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      presenceSettings,
      recentAppsSettings,
      railCollapsedSettings,
      sourceProvider: screenSourceProvider,
      voiceStatus: voiceInputStatus,
      lipsync: lipsyncSettings,
      vad: vadSettings,
      fillerSettings,
      ttsSettings,
      agentSettings,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      importVoice,
      removeUserVoice: removeUserVoiceFile,
      resolveAuditionUrl: (refUrl) => resolveAssetUrl(refUrl),
      onGainPreview: (mouthOpen) => renderer.setMouthOpen(mouthOpen),
      onGainPreviewEnd: () => renderer.stopMouth(),
      // Reset the camera viewpoint to head-on (store drives renderer.setOrbit).
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      // Default instructions to show as placeholder when empty (ignored if config not loaded).
      getDefaultInstructions: () => {
        try {
          return getEndpoints().chat_instructions;
        } catch {
          return undefined;
        }
      },
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      getEndpointDefaults: () => {
        try {
          const e = config.get().endpoints;
          return {
            chat_base_url: e.chat_base_url,
            stt_base_url: e.stt_base_url,
            tts_base_url: e.tts_base_url,
            irodori_base_url: e.irodori_base_url ?? "",
            broker_base_url: e.broker_base_url ?? "",
            chat_model: e.chat_model ?? "",
            chat_api: e.chat_api ?? "",
            tts_voice: e.tts_voice ?? "",
            tts_provider: e.tts_provider ?? "",
          };
        } catch {
          return undefined;
        }
      },
      getDefaultProvider: () => {
        try {
          return config.get().endpoints.tts_provider;
        } catch {
          return undefined;
        }
      },
      getDefaultChatApi: () => {
        try {
          return config.get().endpoints.chat_api;
        } catch {
          return undefined;
        }
      },
      onPopOut: () => openSettings(),
    });
  // DOM surfaces re-mounted on locale change (see i18n subscriber below). Held in
  // let bindings; onActivate arrows read the live binding, so recreating is safe.
  let quickControls = buildQuickControls();
  const buildCaptureIndicator = (): ReturnType<typeof createCaptureIndicator> =>
    createCaptureIndicator({
      mount: root,
      settings: screenshotSettings,
      onActivate: () => quickControls.open(),
    });
  const buildVoiceInputIndicator = (): ReturnType<typeof createVoiceInputIndicator> =>
    createVoiceInputIndicator({
      mount: root,
      status: voiceInputStatus,
      onActivate: () => quickControls.open(),
    });
  let captureIndicator = buildCaptureIndicator();
  let voiceInputIndicator = buildVoiceInputIndicator();

  // Re-mount localized DOM surfaces when display language changes.
  // Defer to microtask so triggering click handler (picker inside quick-controls) unwinds
  // before its host is disposed. Long-lived non-UI singletons (renderer, TTS pipeline, VAD,
  // voiceStatus store) and dispatcher-wired `surfaces` instance intentionally NOT re-created.
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      voiceInputIndicator.dispose();
      captureIndicator.dispose();
      quickControls.dispose();
      quickControls = buildQuickControls();
      captureIndicator = buildCaptureIndicator();
      voiceInputIndicator = buildVoiceInputIndicator();
    });
  });

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    quickControls.open({ x: e.clientX, y: e.clientY });
  }
  stage.addEventListener("contextmenu", onContextMenu);

  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => {
      unsubAnchor();
      unsubscribeLocale();
      quickControls.dispose();
      if (broadcastTimer) clearTimeout(broadcastTimer);
      bridge.dispose();
      disposeStorageSync();
      captureIndicator.dispose();
      voiceInputIndicator.dispose();
      unsubscribeVoiceInputStatus();
      unsubscribeSttPersist();
      void sttVad?.dispose();
      voiceInputStatus.dispose();
      screenshotSettings.dispose();
      idleThrottleSettings.dispose();
      gazeSettings.dispose();
      ttsSettings.dispose();
      sttSettings.dispose();
      proactiveSettings.dispose();
      scheduleSettings.dispose();
      agentNotifySettings.dispose();
      presenceSettings.dispose();
      recentAppsSettings.dispose();
      lipsyncSettings.dispose();
      vadSettings.dispose();
      fillerSettings.dispose();
      agentSettings.dispose();
      endpointsSettings.dispose();
      chatKeySettings.dispose();
      sttKeySettings.dispose();
      ttsKeySettings.dispose();
      cameraSettings.dispose();
      vrmSelection.dispose();
      speakerSelection.dispose();
      osContext.stop();
      windowDropDisposed = true;
      windowDropSource?.stop();
      windowResizeSource?.stop();
      stage.removeEventListener("contextmenu", onContextMenu);
    });
  }

  // ── Dispatcher spine ──────────────────────────────────────────────────────
  // event_bus → dispatcher → backend_caller → streamChat → Hermes → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted drives this loop.
  // bus/dispatcher safe to create before config load (backend_caller reads endpoints at call time
  // from config). backend_caller needs config store, so wire after config creation.
  const bus = createEventBus({
    onDrop: (env, reason) => log.info("drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);
  // Window-sit drop producer: Rust window_drop_release → tier1 perch event.
  // Tauri-only — getCurrentWindow()/invoke/listen require Tauri runtime; in plain browser
  // (Vite dev) skipped so bootstrap continues. DEV mock (__yui_windowSit.drop) exercises
  // geometry path without real drag.
  let windowDropSource: ReturnType<typeof createWindowDropSource> | null = null;
  // Ctrl+wheel pet-window resize producer (Tauri-only, same lifecycle as above).
  let windowResizeSource: ReturnType<typeof createWindowResizeSource> | null = null;
  // Guard teardown/async-assign race: cleanup may run before IIFE assigns.
  let windowDropDisposed = false;
  if (isTauri()) {
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
      windowDropSource = createWindowDropSource({
        bus,
        renderer,
        invoke: (cmd) => invoke(cmd) as Promise<WindowRect[]>,
        getWindow: getCurrentWindow,
        listen: listen as never,
      });
      const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
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
      if (windowDropDisposed) {
        windowDropSource.stop();
        return;
      }
      await windowDropSource.start();
      windowResizeSource.start();
    })().catch((err) =>
      log.warn("window_drop_source_start_failed", {
        degrade: true,
        error: String(err),
      }),
    );
  }
  let sttVad: SttVad | null = null;
  let voiceInputReady = false;
  let voiceInputStartRequested = false;

  async function startVoiceInput(): Promise<void> {
    voiceInputStartRequested = true;
    if (!voiceInputReady || !sttVad) return;
    try {
      await sttVad.start();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Voice input failed";
      voiceInputStatus.set("error", detail);
    }
  }

  function stopVoiceInput(): void {
    voiceInputStartRequested = false;
    sttVad?.stop();
  }

  const unsubscribeVoiceInputStatus = voiceInputStatus.subscribe((snapshot) => {
    if (snapshot.state === "idle") {
      stopVoiceInput();
      return;
    }
    if (snapshot.state === "listening") {
      void startVoiceInput();
    }
  });
  // dispatcher created after config load (backend_caller depends on config.get()), so dev inspection
  // handles can reference it via forward holder.
  let dispatcherRef: Dispatcher | null = null;
  // voice-turn failure error display (~3s) restoration timer — overlapping failures leave previous timer,
  // so always clearTimeout before re-arming to not cut later display early (same pattern as dwellTimer/broadcastTimer).
  let voiceTurnErrorTimer: ReturnType<typeof setTimeout> | null = null;
  // Utterance candidate sources holder — stop them in teardown.
  let proactiveSourceRef: {
    stop(): void;
    noteInteraction(ts?: number): void;
  } | null = null;
  let scheduleSourceRef: { stop(): void } | null = null;
  let agentSourceRef: { stop(): void } | null = null;
  let signalsSourceRef: { stop(): void } | null = null;
  // guardrails also created after config load — hot-reload setConfig reaches holder.
  let guardrailsRef: Guardrails | null = null;
  // broker client created after config load, only if broker_base_url present. hot-swap re-publish and
  // HMR dispose reach holder.
  let brokerRef: BrokerClient | null = null;
  // Global summon hotkey (Tauri-only) — hot-reload reapply reaches holder.
  let summonHotkeyRef: SummonHotkey | null = null;
  // In Tauri webview, broker (localhost:3201) is cross-origin → inject CORS-bypass fetch via selectFetch.
  // Resolve once at boot and cache, reuse same fetch on override reassignment.
  let brokerFetch: typeof fetch | undefined;
  function makeBroker(baseUrl: string): BrokerClient {
    return createBrokerClient({
      baseUrl,
      ...(brokerFetch ? { fetch: brokerFetch } : {}),
    });
  }

  // Load enum table best-effort only for irodori provider. On failure, warn then null →
  // broker degrades to free mode (D4). Doesn't block boot/hot-swap.
  async function loadBrokerTable(
    provider: string | undefined,
  ): Promise<Record<string, string> | null> {
    if (provider !== "irodori") return null;
    try {
      return await loadEmotionTextTable({ provider: "irodori" });
    } catch (err) {
      log.warn("emotion_text_load_failed", {
        fallback: "free",
        error: String(err),
      });
      return null;
    }
  }

  // Submit → fire to dispatcher spine (user.text_submitted). Keep input open, switch send→stop (subscribeBusy),
  // return to send on turn complete. mock kept for DEV demo only.
  surfaces.onSubmit((text, images) => {
    userInput.submit(text, images);
    // Conversation with YUI → reset proactive response dramatization elapsed timer.
    proactiveSourceRef?.noteInteraction();
  });

  // Hotkey: summon input via SUMMON_KEY when window focused. (Esc/Enter handled inside input)
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== SUMMON_KEY || e.metaKey || e.ctrlKey || e.altKey) return;
    if (surfaces.isInputOpen()) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    surfaces.summonInput();
  }
  window.addEventListener("keydown", onKeydown);

  // DEV-only: handles for direct invocation from screenshot validation loop.
  if (import.meta.env.DEV) {
    const { createMockDriver } = await import("./ui/mock");
    const mock = createMockDriver(surfaces);
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
      __yui_dispatcher: () => dispatcherRef,
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

  // Config-driven load: configs/*.json → validated AppConfig. endpoints/motions etc
  // consumed during dispatcher·tts wiring. VRM displayed via avatar.vrm_url.
  // Chat key injected via SecretProvider — dev uses Vite env, prod/OSS replaces with keychain impl.
  // dispatcher resolves via `await config.secrets.get(CHAT_API_KEY_SECRET)` on streamChat call.
  const config = createConfigStore({
    secrets: createSettingsSecretProvider({
      stores: {
        [CHAT_API_KEY_SECRET]: chatKeySettings,
        [STT_API_KEY_SECRET]: sttKeySettings,
        [TTS_API_KEY_SECRET]: ttsKeySettings,
      },
      fallback: {
        [CHAT_API_KEY_SECRET]: import.meta.env.VITE_YUI_CHAT_KEY,
        [STT_API_KEY_SECRET]: import.meta.env.VITE_YUI_STT_KEY,
        [TTS_API_KEY_SECRET]: import.meta.env.VITE_YUI_TTS_KEY,
      },
    }),
  });
  // No runtime override + no build-time key → chat call looks like silent 401 →
  // warn early in bootstrap. Never log key value itself (secret).
  if (import.meta.env.DEV && !chatKeySettings.get().apiKey && !import.meta.env.VITE_YUI_CHAT_KEY) {
    log.warn(
      "chat API 키 미설정 — chat은 무인증 placeholder로 호출돼 401 가능. 설정 패널의 채팅 API 키 또는 .env.local(VITE_YUI_CHAT_KEY) 참고.",
    );
  }
  // STT/openai-TTS key warning (prevent 401 on gated backends requiring keys). irodori key not needed.
  if (import.meta.env.DEV && !sttKeySettings.get().apiKey && !import.meta.env.VITE_YUI_STT_KEY) {
    log.warn(
      "STT API 키 미설정 — 키를 요구하는 STT 서버라면 401 가능. .env.local(VITE_YUI_STT_KEY) 참고.",
    );
  }
  if (import.meta.env.DEV && !ttsKeySettings.get().apiKey && !import.meta.env.VITE_YUI_TTS_KEY) {
    log.warn(
      "TTS API 키 미설정 — openai 호환 TTS가 키를 요구하면 401 가능. .env.local(VITE_YUI_TTS_KEY) 참고. (irodori는 불필요)",
    );
  }
  // synth injected as closure reading config (hot-reload) and selectFetch at call time.
  // Eager eval config.get() here forbidden — throw before load() kills bootstrap.
  // Playback amplitude flows from renderer mouth shape, completion flows from bubble fade release (speech-playback).
  // irodori synth closure memoized per speaker/tuning keys + 422 self-heal. Not reconstructed per sentence.
  let irodoriFactory: TtsSynth | undefined;
  const irodoriSynth = async (input: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    const f = await selectFetch();
    irodoriFactory ??= createIrodoriSynthFactory({
      getParams: () => {
        const eps = getEndpoints();
        const active = speakerSelection.getActive();
        if (!eps.irodori_base_url || !active.id) {
          throw new Error("irodori provider requires irodori_base_url + irodori_speaker");
        }
        return {
          baseUrl: eps.irodori_base_url,
          referenceId: active.id,
          refUrl: active.ref_url,
          numSteps: eps.irodori_num_steps,
          cfgScaleText: eps.irodori_cfg_scale_text,
          cfgScaleSpeaker: eps.irodori_cfg_scale_speaker,
          seconds: eps.irodori_seconds,
        };
      },
      ensureRegistered,
      evictRegistration,
      buildSynth: (p, fetchImpl) =>
        createIrodoriSynth({
          baseUrl: p.baseUrl,
          referenceId: p.referenceId,
          fetch: fetchImpl,
          numSteps: p.numSteps,
          cfgScaleText: p.cfgScaleText,
          cfgScaleSpeaker: p.cfgScaleSpeaker,
          seconds: p.seconds,
        }),
      fetch: f ?? globalThis.fetch,
    });
    return irodoriFactory(input, signal);
  };

  // Filler loop speaks via speechPlayback (speak), speechPlayback playback completion (onPlaybackEnd)
  // triggers loop's next iteration — mutual reference, break cycle with forward let.
  let fillerLoop: import("./io/filler-loop").FillerLoop | undefined;
  // Token of turn owning current thinking. When turns overlap (supersede), late onThinkingEnd
  // of overtaken turn must not clean up single fillerLoop/motion, so ignore if token differs from current.
  let currentThinkingTurn: object | null = null;
  const speechPlayback = createSpeechPlayback({
    renderer,
    surfaces,
    onPlaybackEnd: () => fillerLoop?.onUtteranceDone(),
    pipeline: {
      sink: createWebAudioSink({ getGain: () => lipsyncSettings.get().gain }),
      // Function form → lazy resolution each drain (no eager config read, hot-reload friendly).
      maxInflight: () => getEndpoints().tts_max_inflight ?? 1,
      synth: async (input, signal) => {
        // TTS inactive (toggle OFF or server unset) quietly skip — expressions/motions, bubble unchanged.
        if (!ttsSettings.get().enabled) return Promise.reject(TTS_SKIP);
        const eps = getEndpoints();
        if (eps.tts_provider === "irodori") {
          if (!eps.irodori_base_url || !speakerSelection.getActive().id) {
            return Promise.reject(TTS_SKIP);
          }
          return irodoriSynth(input, signal);
        }
        if (!eps.tts_base_url) return Promise.reject(TTS_SKIP);
        const f = await selectFetch();
        return createTtsSynth({
          config: eps,
          fetch: f,
          model: eps.tts_model,
          voice: eps.tts_voice,
          speed: eps.tts_speed,
          getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
        })(input, signal);
      },
    },
  });
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => speechPlayback.dispose());
    Object.assign(globalThis as Record<string, unknown>, {
      __yuiSpeech: speechPlayback,
    });
  }

  // ── TTFT filler ───────────────────────────────────────────────────────────
  // Read current filler settings + config snapshot live at call time to create effective pool
  // (forbidden to capture at boot — hot-reload/settings changes reflected in next turn).
  const effectiveFiller = () => effectiveFillerPool(fillerSettings.get(), config.get().filler);

  // Filler loop — speak(speechPlayback) + live pools/timing. Close cycle by assigning to forward let.
  fillerLoop = createFillerLoop({
    speak: (t) => speechPlayback.onSpeech(t),
    getPools: effectiveFiller,
    getTiming: () => ({
      gapMs: config.get().filler.gap_ms,
      jitterMs: config.get().filler.gap_jitter_ms,
    }),
  });

  // ── Session continuity ───────────────────────────────────────────────────────────
  // Conversation threading via OpenAI Responses previous_response_id — read prior id each turn
  // (getPreviousResponseId), save new response id on success (onResponseId).
  // session store created early above as wireStorageSync target.
  const backendCaller = createBackendCaller({
    get config() {
      return getEndpoints();
    },
    renderer,
    getApiKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    getFetch: () => selectFetch(),
    getPreviousResponseId: () => sessionStore.get() ?? undefined,
    onResponseId: (id) => sessionStore.set(id),
    transcript: chatHistoryStore,
    onUsage: (usage) => {
      sessionDiagnostics.setUsage(
        usage.total_tokens,
        getEndpoints().chat_model_context_window ?? null,
      );
    },
    onSpeech: (text) => speechPlayback.onSpeech(text),
    onSpeechDelta: (text) => speechPlayback.onSpeechDelta(text),
    onSpeechEnd: () => speechPlayback.onSpeechEnd(),
    onSpeechInterrupt: () => speechPlayback.interrupt(),
    onSpeechAbort: () => speechPlayback.abort(),
    onCue: (cue) => speechPlayback.setCue(cue),
    onToolStatus: (s) =>
      s.state === "running"
        ? surfaces.showTool(s.tool_id ?? "")
        : s.state === "done"
          ? surfaces.finishTool()
          : surfaces.hideTool(),
    getScreenshot: async () => {
      const s = screenshotSettings.get();
      if (!s.enabled) return undefined;
      const cap = await screenCapturer.capture(s.source);
      return buildScreenshotBlock(s, cap ?? undefined);
    },
    getOsContext: () => osContext.get(),
    peekRecentApps: () => osContext.peekRecentApps(),
    drainRecentApps: (only) => osContext.drainRecentApps(only),
    getAgentSettings: () => agentSettings.get(),
    // TTFT thinking: dispatcher owns only timing — arm timer only if effective pool not empty.
    getFiller: () => {
      const pool = effectiveFiller();
      return pool.first.length > 0 || pool.repeat.length > 0;
    },
    // First token delay: thinking motion (loop) + filler loop start (first utterance → repeat). Loop owns speaking.
    onThinkingStart: (token) => {
      // Synchronously declare this turn owns thinking — overlapping next turn start supersedes if it arrives.
      currentThinkingTurn = token;
      // hold BEFORE the first filler can speak so no filler sentence resets the motion.
      speechPlayback.holdMotion(true);
      // Motion yields when a higher-priority state is current (e.g. window_sit perch:
      // thinking is interrupt_policy "ignore"), but the filler voice always speaks —
      // the utterance is independent of the motion decision.
      renderer.playMotion({ id: "thinking", loop: true });
      fillerLoop?.start();
    },
    // Thinking end → filler loop stop + idle baseline return. thinking is loop:true/kind:"state",
    // so without cue spins forever and pollutes previousStable; end by returning to idle to prevent both.
    // (backend motion cue priority 70 replaces idle as-is on arrival.)
    // Ignore late end of overtaken turn (token != current) — single fillerLoop/motion owns current turn.
    onThinkingEnd: (token) => {
      if (token !== currentThinkingTurn) return;
      currentThinkingTurn = null;
      speechPlayback.holdMotion(false);
      fillerLoop?.stop();
      renderer.playMotion(null);
    },
  });
  // dispatcher/guardrails created after config load (guardrails needs cfg.guardrails numbers).
  try {
    const cfg = await config.load();
    // Guardrails — configured by config numbers. dispatcher consumes via note+evaluate+cooldown polling.
    const guardrails = createGuardrails(cfg.guardrails);
    guardrailsRef = guardrails;
    const dispatcher = createDispatcher({
      bus,
      renderer,
      backendCaller,
      guardrails,
      isSpeaking: () => speechPlayback.isSpeaking(),
      // Surface only user-initiated turn failures (proactive/schedule/agent log only — silent by design).
      // Route by source (text/voice) — checking isInputOpen() only at failure time risks misrouting
      // escaped typed turns to voice surface, so routeTurnFailure prioritizes source.
      onUserTurnFailed: (reason, source) => {
        const message = turnErrorMessage(reason);
        if (!message) return;
        const action = routeTurnFailure(source, surfaces.isInputOpen());
        if (action.kind === "show_input_error") {
          surfaces.showInputError(message);
        } else if (action.kind === "voice_error") {
          // Briefly reuse existing error state of voice-input-indicator (no new DOM).
          // Overlapping failures: clearTimeout before re-arming so previous timer doesn't cut new display early.
          if (voiceTurnErrorTimer !== null) clearTimeout(voiceTurnErrorTimer);
          voiceInputStatus.set("error", reason);
          voiceTurnErrorTimer = setTimeout(() => {
            voiceTurnErrorTimer = null;
            if (voiceInputStatus.get().state === "error") voiceInputStatus.set("listening");
          }, VOICE_TURN_ERROR_DISPLAY_MS);
        }
        // action.kind === "none": typed turn already closed before failure reached — log only (dispatcher already recorded).
      },
    });
    dispatcherRef = dispatcher;
    // In-flight backend turn ↔ input send/stop toggle. Stop click → explicit cancel (client-side abort).
    dispatcher.subscribeBusy((busy) => surfaces.setBusy(busy));
    surfaces.onStop(() => dispatcher.cancel());
    // HMR module re-run leaves stale dispatcher setInterval/in-flight → stop in dispose.
    if (import.meta.env.DEV) {
      import.meta.hot?.dispose(() => {
        dispatcher.stop();
        if (voiceTurnErrorTimer !== null) clearTimeout(voiceTurnErrorTimer);
        proactiveSourceRef?.stop();
        scheduleSourceRef?.stop();
        agentSourceRef?.stop();
        signalsSourceRef?.stop();
        sessionStore.dispose();
        sessionDiagnostics.dispose();
        chatHistoryStore.dispose();
      });
    }
    const { createSttVad } = await import("./io/stt-vad");
    sttVad = createSttVad({
      config: cfg.endpoints,
      // Lazy: re-read silence threshold each time VAD starts so slider changes take effect.
      silenceMs: () => vadSettings.get().silenceMs,
      getApiKey: () => config.secrets.get(STT_API_KEY_SECRET),
      onVoiceSegment: (text) => {
        userInput.submitVoice(text);
        proactiveSourceRef?.noteInteraction();
      },
      onState: (state, detail) => voiceInputStatus.set(state, detail),
      onSpeechActive: () => {
        if (vadSettings.get().bargeIn && speechPlayback.isSpeaking()) {
          speechPlayback.interrupt({ muteCurrentTurn: true });
        }
      },
    });
    voiceInputReady = true;
    // Auto-resume if left on in previous session (sttSettings.enabled). Unify on single start;
    // if server unset, start() is no-op so onState doesn't fire, status quietly stays idle.
    if (
      voiceInputStartRequested ||
      voiceInputStatus.get().state !== "idle" ||
      sttSettings.get().enabled
    ) {
      void startVoiceInput();
    }
    // Inject emotion/motion registry into renderer → setEmotion/playMotion (= applyDirective) works.
    renderer.setEmotionRegistry(cfg.emotionRegistry);
    renderer.setMotionRegistry(cfg.motions);
    // Inject full-body fit-to-bounds framing knob — set before first VRM load.
    renderer.setFraming(cfg.avatar.framing ?? {});
    // Inject camera gaze-fit thresholds (configs/avatar.json gaze; omitted keys keep defaults).
    renderer.setGaze(cfg.avatar.gaze ?? {});
    // Per-pixel alpha hit-test threshold (configs/avatar.json hit_test.alpha_threshold).
    const bootAlpha = cfg.avatar.hit_test?.alpha_threshold;
    if (bootAlpha !== undefined) renderer.setHitTestThreshold(bootAlpha);
    // Inject actual manifest then boot load → persisted overrides take effect at startup.
    vrmSelection.setManifest({
      available: cfg.avatar.available,
      defaultUrl: cfg.avatar.vrm_url,
    });
    speakerSelection.setManifest({
      available: cfg.endpoints.irodori_voices,
      defaultId: cfg.endpoints.irodori_speaker ?? "",
    });
    await loadVrmSerialized(vrmSelection.getActive().url);
    // First-run onboarding hint — once when character visible, exposed via existing speech bubble.
    maybeShowFirstRunHint({
      seen: () => hintSettings.get().seen,
      markSeen: () => hintSettings.setSeen(true),
      surfaces,
      hotkey: cfg.hotkeys.summon_global,
      isMac: /Mac/.test(navigator.platform || navigator.userAgent),
      t,
    });
    // Click-through hit-test: interactive over character/visible UI, click-through empty areas elsewhere.
    // interactive = renderer.hitTest(stage-local) ∪ visible input form ∪ open quick-controls.
    // All coordinates viewport(client) basis — only renderer.hitTest transforms to stage top-left basis.
    const interactiveRects = (): DOMRect[] => {
      const rects: DOMRect[] = [];
      const inputForm = root.querySelector<HTMLElement>(".yui-input.is-open");
      if (inputForm) rects.push(inputForm.getBoundingClientRect());
      if (quickControls.isOpen()) rects.push(quickControls.el.getBoundingClientRect());
      return rects;
    };
    const pointInRect = (x: number, y: number, r: DOMRect, margin: number): boolean =>
      x >= r.left - margin &&
      x <= r.right + margin &&
      y >= r.top - margin &&
      y <= r.bottom + margin;
    const hitTest = createHitTestController({
      isOverInteractive: (xClient, yClient, marginPx) => {
        const stageRect = stage.getBoundingClientRect();
        if (renderer.hitTest(xClient - stageRect.left, yClient - stageRect.top)) return true;
        return interactiveRects().some((r) => pointInRect(xClient, yClient, r, marginPx));
      },
      moveTarget: window,
      // Hot-reload friendly: read config store each tick so knob edits take effect.
      getConfig: () => config.get().avatar.hit_test ?? {},
    });
    hitTestRef = hitTest;
    hitTest.start();
    if (import.meta.env.DEV) import.meta.hot?.dispose(() => hitTest.stop());
    // Start dispatcher only after config ready (backend_caller depends on config.get()).
    dispatcher.start();
    // tier2 utterance candidate sources: fire proactive.<id> (dramatization N mins idle) and
    // schedule.<id> (time-of-day greeting) over presence gate. Gated by shared presence store + per-setting store.
    // Start after dispatcher running — firing consumed immediately. Stop together in teardown.
    const proactiveSource = createProactiveSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      getCues: () => proactiveSettings.get().entries,
      isEnabled: () => proactiveSettings.get().enabled,
    });
    proactiveSourceRef = proactiveSource;
    void proactiveSource.start();
    const scheduleSource = createScheduleSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      getCues: () => scheduleSettings.get().entries,
      isEnabled: () => scheduleSettings.get().enabled,
    });
    scheduleSourceRef = scheduleSource;
    void scheduleSource.start();
    // Agent completion watcher: fire agent.done / idle→present edge fires agent.catchup from Tauri IPC inbox.
    const agentSource = createAgentSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      isEnabled: () => agentNotifySettings.get().enabled,
    });
    agentSourceRef = agentSource;
    void agentSource.start();
    // Signals watcher: fire signals.push / idle→present edge fires signals.catchup from signals-inbox channel
    // of same loopback ingress (gated by agentNotifySettings) — payload passed through opaque.
    const signalsSource = createSignalsSource({
      bus,
      present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
      isEnabled: () => agentNotifySettings.get().enabled,
    });
    signalsSourceRef = signalsSource;
    void signalsSource.start();
    // Global summon hotkey: register configs/hotkeys.json accelerator OS-globally (Tauri-only —
    // skipped in browser dev). On fire: show+focus window then summon input. Registration failure:
    // summon-hotkey warns then treats as inactive (fail-soft).
    if (isTauri()) {
      void (async () => {
        const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const summonHotkey = createSummonHotkey({
          register,
          unregister,
          // On macOS, include background app activation, bring forward (show before hidden).
          focusWindow: async () => {
            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
          },
          summonInput: () => surfaces.summonInput(),
          isInputOpen: () => surfaces.isInputOpen(),
        });
        summonHotkeyRef = summonHotkey;
        await summonHotkey.apply(cfg.hotkeys.summon_global);
        if (import.meta.env.DEV) {
          import.meta.hot?.dispose(() => void summonHotkey.dispose());
        }
      })().catch((err) => log.warn("summon_hotkey_wire_failed", { error: String(err) }));
    }
    // Expression Broker publish(D6): only runs if broker_base_url present (effective override-merged).
    // publish→start is fire-and-forget — doesn't block boot critical path (D4).
    const bootEps = getEndpoints();
    brokerFetch = (await selectFetch()) ?? undefined;
    if (bootEps.broker_base_url) {
      const table = await loadBrokerTable(bootEps.tts_provider);
      brokerRef = makeBroker(bootEps.broker_base_url);
      const payload = deriveBrokerPayload({ ...cfg, endpoints: bootEps }, table);
      void brokerRef.publish(payload).then(() => brokerRef?.start());
    } else {
      log.debug("broker_disabled", { reason: "no_broker_base_url" });
    }

    // Reflect override changes (voice engine, broker URL) live to broker. config.subscribe sees
    // disk edits only, so wire separately (best-effort).
    const brokerReconciler = createBrokerOverrideReconciler({
      getEffectiveEndpoints: getEndpoints,
      getBroker: () => brokerRef,
      setBroker: (b) => {
        brokerRef = b;
      },
      createBroker: makeBroker,
      loadTable: loadBrokerTable,
      derivePayload: (eff, table) =>
        deriveBrokerPayload({ ...config.get(), endpoints: eff }, table),
    });
    const unsubscribeBrokerOverride = endpointsSettings.subscribe(() => {
      void brokerReconciler.onChange();
    });
    if (import.meta.env.DEV) import.meta.hot?.dispose(unsubscribeBrokerOverride);
  } catch (err) {
    log.error("config_or_vrm_load_failed", { error: String(err) });
    // Boot failure = empty transparent window. Preserve cause (ConfigError vs VRM) visible to user (#316).
    showBootError(root, err);
  }

  // Hot-reload: when avatar manifest changes, update via setManifest then hot-swap active VRM.
  // override-wins: config vrm_url edits don't overwrite user's localStorage selection (same as agent-settings).
  config.subscribe((cfg, changed) => {
    // emotion/motion registry hot-reload → renderer re-inject (immediate effect).
    if (changed.has("emotionRegistry")) renderer.setEmotionRegistry(cfg.emotionRegistry);
    if (changed.has("motions")) renderer.setMotionRegistry(cfg.motions);
    // guardrails numbers hot-reload — preserve runtime DND/counter state, replace config only.
    if (changed.has("guardrails")) guardrailsRef?.setConfig(cfg.guardrails);
    // Global summon hotkey hot-reload — unregister existing, register new accelerator (empty string = inactive).
    if (changed.has("hotkeys")) void summonHotkeyRef?.apply(cfg.hotkeys.summon_global);
    // irodori speaker manifest hot-reload — synth reads via getActive() on next utterance, so just reload.
    if (changed.has("endpoints")) {
      speakerSelection.setManifest({
        available: cfg.endpoints.irodori_voices,
        defaultId: cfg.endpoints.irodori_speaker ?? "",
      });
    }
    // Broker re-publish(D6): sync when config section building renderable vocab changes. Best-effort.
    // Publish via override-merged effective endpoints so disk edits don't overwrite user overrides.
    if (
      brokerRef &&
      (changed.has("emotionRegistry") || changed.has("motions") || changed.has("endpoints"))
    ) {
      const eff = getEndpoints();
      void loadBrokerTable(eff.tts_provider).then((table) => {
        void brokerRef?.publish(deriveBrokerPayload({ ...cfg, endpoints: eff }, table));
      });
    }
    if (!changed.has("avatar")) return;
    // Framing knob hot-reload — update before hot-swap re-fit.
    renderer.setFraming(cfg.avatar.framing ?? {});
    // Gaze thresholds hot-reload.
    renderer.setGaze(cfg.avatar.gaze ?? {});
    const reloadAlpha = cfg.avatar.hit_test?.alpha_threshold;
    if (reloadAlpha !== undefined) renderer.setHitTestThreshold(reloadAlpha);
    vrmSelection.setManifest({
      available: cfg.avatar.available,
      defaultUrl: cfg.avatar.vrm_url,
    });
    void loadVrmSerialized(vrmSelection.getActive().url).catch((err) =>
      log.error("vrm_hot_swap_failed", { error: String(err) }),
    );
  });
  config.onError((err) =>
    log.error("config_reload_failed", {
      kept_previous: true,
      error: String(err),
    }),
  );
  // DEV-only: polling watcher runs — edits to configs/*.json reflected immediately.
  if (import.meta.env.DEV) {
    config.start();
    Object.assign(globalThis as Record<string, unknown>, {
      __yuiConfig: config,
    });
    // HMR module re-run stacks previous store's setInterval → stop in dispose.
    import.meta.hot?.dispose(() => config.stop());
    // Broker liveness poll setInterval also cleaned up between HMR to prevent leak.
    import.meta.hot?.dispose(() => brokerRef?.dispose());
  }
}

/** Don't intercept hotkey if focus already on input element. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

void bootstrap();
