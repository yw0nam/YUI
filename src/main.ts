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
import {
  createSettingsBroadcast,
  type SyncedStore,
  wireBroker,
  wireDispatcherSources,
  wirePeekExitTriggers,
  wireSettingsReload,
  wireSpeakerSelection,
  wireStopControl,
  wireSummonHotkey,
  wireVoiceInput,
  wireVrmSelection,
  wireWindowSources,
} from "./bootstrap-wiring";
import {
  CHAT_API_KEY_SECRET,
  createConfigStore,
  GESTURE_CUES_DEFAULTS,
  type GestureCuesConfig,
  PEEK_DEFAULTS,
  type PeekConfig,
  STT_API_KEY_SECRET,
  TAP_DEFAULTS,
  type TapConfig,
  TTS_API_KEY_SECRET,
} from "./config";
import type { WindowRect } from "./contract";
import { createBackendCaller } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import { createEventBus } from "./dispatcher/event-bus";
import { createGuardrails, type Guardrails } from "./dispatcher/guardrails";
import { createUserInputSource } from "./dispatcher/user-input-source";
import { initDrag } from "./drag";
import { resolveAssetUrl } from "./io/asset-url";
import {
  CAMERA_ORBIT_SENSITIVITY,
  CAMERA_WHEEL_SENSITIVITY,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
} from "./io/camera-settings";
import { selectFetch } from "./io/chat-client";
import { createDragHoldSource, type DragHoldSource } from "./io/drag-hold-source";
import { mergeEndpoints } from "./io/endpoints-settings";
import { createHitTestController, type HitTestController } from "./io/hit-test";
import { createOsContext } from "./io/os-context";
import { createPeekState } from "./io/peek-state";
import { buildScreenshotBlock } from "./io/screenshot-context";
import { createSettingsSecretProvider } from "./io/secret-provider";
import { createSettingsBridge } from "./io/settings-bridge";
import { createSettingsStores } from "./io/settings-stores";
import { createSettingsWindowOpener, wireStorageSync } from "./io/settings-window";
import type { SummonHotkey } from "./io/summon-hotkey";
import { createTapSource, type TapSource } from "./io/tap-source";
import { isTauri } from "./io/tauri-env";
import { resolveScreenCapturer, resolveScreenSourceProvider } from "./io/tauri-screen";
import { removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { removeUserVrm } from "./io/vrm-import";
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
import { showChainResetNotice } from "./ui/chain-reset-notice";
import { maybeShowFirstRunHint } from "./ui/first-run-hint";
import { getLocale, subscribe as subscribeLocale, t } from "./ui/i18n";
import { createQuickControls } from "./ui/quick-controls";
import { createSurfaces } from "./ui/surfaces";
import { routeTurnFailure, turnErrorMessage } from "./ui/turn-error";
import { createVoiceInputIndicator } from "./ui/voice-input-indicator";
import { createVoiceInputStatus } from "./ui/voice-input-status";
import { wireVoicePipeline } from "./voice-pipeline-wiring";

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
  let tapSourceRef: TapSource | null = null;
  let dragHoldRef: DragHoldSource | null = null;
  const cleanupDrag = await initDrag(stage, {
    onClick: (pos) => tapSourceRef?.handleClick(pos),
    onDragStart: () => {
      hitTestRef?.suspend();
      dragHoldRef?.noteDragStart();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_start",
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
      });
    },
    onDragEnd: () => {
      hitTestRef?.resume();
      dragHoldRef?.noteDragEnd();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_end",
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
      });
    },
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
    workflowSettings,
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
  } = createSettingsStores({ locale: getLocale() });
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
  // Cross-window settings sync (bidirectional, loop-guarded, debounced): one side edits → emit →
  // other side reloads. cameraSettings is excluded from the array since its reload propagates to
  // zoom (handled inside wireSettingsReload). The broadcast half is wired first so the VRM/speaker
  // selections below can broadcast through it; the reload half is wired after they exist.
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
    workflowSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
    idleThrottleSettings,
    ttsSettings,
  ];
  const {
    broadcastSettings,
    runApplyingRemote,
    dispose: disposeSettingsBroadcast,
  } = createSettingsBroadcast({ bridge, syncedStores: syncedSettingsStores, cameraSettings });
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
  wireSettingsReload({
    bridge,
    syncedStores: syncedSettingsStores,
    cameraSettings,
    runApplyingRemote,
    vrmSelection,
    loadVrmSerialized,
    speakerSelection,
    log,
  });

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: root,
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      proactiveSettings,
      scheduleSettings,
      workflowSettings,
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
      disposeSettingsBroadcast();
      bridge.dispose();
      disposeStorageSync();
      captureIndicator.dispose();
      voiceInputIndicator.dispose();
      voiceInput.dispose();
      voiceInputStatus.dispose();
      screenshotSettings.dispose();
      idleThrottleSettings.dispose();
      gazeSettings.dispose();
      ttsSettings.dispose();
      sttSettings.dispose();
      proactiveSettings.dispose();
      scheduleSettings.dispose();
      workflowSettings.dispose();
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
  let peekStateRef: ReturnType<typeof createPeekState> | null = null;
  let peekConfig: PeekConfig = { ...PEEK_DEFAULTS };
  let tapConfig: TapConfig = TAP_DEFAULTS;
  let gestureCuesConfig: GestureCuesConfig = GESTURE_CUES_DEFAULTS;
  // Window-sit drop producer (Rust window_drop_release → tier1 perch) + ctrl+wheel resize
  // producer + agent loopback ingress bind. Tauri-only; owns its own HMR teardown.
  // DEV mock (__yui_windowSit.drop) exercises the geometry path without a real drag.
  wireWindowSources({
    bus,
    renderer,
    peekActive: () => peekStateRef?.active() ?? false,
    getPeekConfig: () => peekConfig,
    getGestureCues: () => gestureCuesConfig,
    agentNotifySettings,
    log,
  });
  // Voice input (STT/VAD) lifecycle — start/stop driven by voiceInputStatus, intent persisted to
  // sttSettings, STT engine bound post-config via setStt. Barge-in/submit wiring joins the voice pipeline below.
  const voiceInput = wireVoiceInput({ voiceInputStatus, sttSettings });
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
  // Global summon hotkey (Tauri-only) — hot-reload reapply reaches holder.
  let summonHotkeyRef: SummonHotkey | null = null;
  // Expression Broker handle — created after config load only if broker_base_url present.
  // config.subscribe re-publish and HMR dispose reach it via this holder.
  let brokerHandle: Awaited<ReturnType<typeof wireBroker>> | null = null;

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
  const voice = wireVoicePipeline({
    renderer,
    surfaces,
    getEndpoints,
    getFillerConfig: () => config.get().filler,
    getTtsApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    getSttApiKey: () => config.secrets.get(STT_API_KEY_SECRET),
    ttsSettings,
    lipsyncSettings,
    fillerSettings,
    vadSettings,
    speakerSelection,
    voiceInputStatus,
    onVoiceSegment: (text) => {
      userInput.submitVoice(text);
      proactiveSourceRef?.noteInteraction();
    },
  });
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => voice.dispose());
    Object.assign(globalThis as Record<string, unknown>, {
      __yuiSpeech: voice.speechPlayback,
    });
  }

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
    onResponseIdInvalid: () => sessionStore.clear(),
    onChainReset: () => showChainResetNotice({ surfaces, t }),
    transcript: chatHistoryStore,
    onUsage: (usage) => {
      sessionDiagnostics.setUsage(
        usage.total_tokens,
        getEndpoints().chat_model_context_window ?? null,
      );
    },
    onSpeech: (text) => voice.speechPlayback.onSpeech(text),
    onSpeechDelta: (text) => voice.speechPlayback.onSpeechDelta(text),
    onSpeechEnd: () => voice.speechPlayback.onSpeechEnd(),
    onSpeechInterrupt: () => voice.speechPlayback.interrupt(),
    onSpeechAbort: () => voice.speechPlayback.abort(),
    onCue: (cue) => voice.speechPlayback.setCue(cue),
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
    getPosture: () => dispatcherRef?.getPosture(),
    peekRecentApps: () => osContext.peekRecentApps(),
    drainRecentApps: (only) => osContext.drainRecentApps(only),
    getAgentSettings: () => agentSettings.get(),
    getFiller: voice.hasFiller,
    onThinkingStart: voice.onThinkingStart,
    onThinkingEnd: voice.onThinkingEnd,
  });
  // dispatcher/guardrails created after config load (guardrails needs cfg.guardrails numbers).
  try {
    const cfg = await config.load();
    peekConfig = cfg.avatar.peek;
    tapConfig = cfg.avatar.tap;
    gestureCuesConfig = cfg.avatar.gesture_cues;
    // Guardrails — configured by config numbers. dispatcher consumes via note+evaluate+cooldown polling.
    const guardrails = createGuardrails(cfg.guardrails);
    guardrailsRef = guardrails;
    const dispatcher = createDispatcher({
      bus,
      renderer,
      backendCaller,
      guardrails,
      peek: {
        enter: () => peekStateRef?.enter() ?? Promise.resolve(),
        exit: () => peekStateRef?.exit() ?? Promise.resolve(),
      },
      peekConfig: () => peekConfig,
      tapConfig: () => tapConfig,
      isSpeaking: () => voice.speechPlayback.isSpeaking(),
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
    // In-flight backend turn ↔ input send/stop toggle. Stop click → explicit cancel + speech abort.
    dispatcher.subscribeBusy((busy) => surfaces.setBusy(busy));
    wireStopControl({
      onStop: (cb) => surfaces.onStop(cb),
      cancel: () => dispatcher.cancel(),
      abortSpeech: () => voice.speechPlayback.abort(),
    });
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
    const sttVad = await voice.createSttEngine(cfg.endpoints);
    // Bind the engine + auto-resume if left on last session (handled inside wireVoiceInput).
    voiceInput.setStt(sttVad);
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
    let disposePeekExitTriggers: (() => void) | null = null;
    if (isTauri()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      peekStateRef = createPeekState({ getWindow: getCurrentWindow });
      disposePeekExitTriggers = await wirePeekExitTriggers({
        bus,
        peek: peekStateRef,
        win: {
          onFocusChanged: (handler) => win.onFocusChanged(handler),
          listen: (event, handler) => win.listen(event, handler),
        },
      });
    }
    if (import.meta.env.DEV) {
      import.meta.hot?.dispose(() => {
        disposePeekExitTriggers?.();
        void peekStateRef?.dispose();
        hitTest.stop();
      });
    }
    // Start dispatcher only after config ready (backend_caller depends on config.get()).
    dispatcher.start();
    // tier2 utterance candidate sources (proactive/schedule/agent/signals). Start after the
    // dispatcher is running — firing is consumed immediately. Stop together in teardown.
    const { proactiveSource, scheduleSource, agentSource, signalsSource } = wireDispatcherSources({
      bus,
      presenceSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
    });
    proactiveSourceRef = proactiveSource;
    scheduleSourceRef = scheduleSource;
    agentSourceRef = agentSource;
    signalsSourceRef = signalsSource;
    tapSourceRef = createTapSource({
      bus,
      renderer,
      ambient,
      config: cfg.avatar.tap,
      drainSignals: () => signalsSource.drain(),
    });
    dragHoldRef = createDragHoldSource({
      bus,
      getHoldMs: () => config.get().avatar.drag_hold_ms,
      getCue: () => gestureCuesConfig.drag_held,
    });
    // Global summon hotkey: register configs/hotkeys.json accelerator OS-globally. onReady holds
    // the handle so the config.subscribe below can re-apply it on hot-reload.
    wireSummonHotkey({
      surfaces,
      bus,
      peek: {
        active: () => peekStateRef?.active() ?? false,
        exit: () => peekStateRef?.exit() ?? Promise.resolve(),
      },
      accelerator: cfg.hotkeys.summon_global,
      onReady: (hk) => {
        summonHotkeyRef = hk;
      },
      log,
    });
    // Expression Broker publish (D6): fire-and-forget initial publish + live override reconcile.
    // Owns its own fetch resolution + client lifecycle; disk-config re-publish flows via onConfigChange below.
    brokerHandle = await wireBroker({
      getConfig: () => config.get(),
      getEndpoints,
      endpointsSettings,
      log,
    });
    if (import.meta.env.DEV) import.meta.hot?.dispose(() => brokerHandle?.dispose());
  } catch (err) {
    log.error("config_or_vrm_load_failed", { error: String(err) });
    // Boot failure = empty transparent window. Preserve cause (ConfigError vs VRM) visible to user (#316).
    showBootError(root, err);
  }

  // Hot-reload: when avatar manifest changes, update via setManifest then hot-swap active VRM.
  // override-wins: config vrm_url edits don't overwrite user's localStorage selection (same as agent-settings).
  config.subscribe((cfg, changed) => {
    if (changed.has("avatar")) {
      peekConfig = cfg.avatar.peek;
      tapConfig = cfg.avatar.tap;
      gestureCuesConfig = cfg.avatar.gesture_cues;
    }
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
    // Broker re-publish on disk-config edits that change renderable vocab (best-effort; override-merged inside).
    brokerHandle?.onConfigChange(cfg, changed);
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
  }
}

/** Don't intercept hotkey if focus already on input element. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

void bootstrap();
