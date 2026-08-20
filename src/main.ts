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
import { createConfiguredBootstrap } from "./bootstrap-configured";
import {
  wireCrossWindowSync,
  wireDevGlobals,
  wireSettingsReload,
  wireSpeakerSelection,
  wireVrmSelection,
} from "./bootstrap-wiring";
import {
  CHAT_API_KEY_SECRET,
  createConfigStore,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "./config";
import { createEventBus } from "./dispatcher/event-bus";
import { createUserInputSource } from "./dispatcher/user-input-source";
import { agentTriggerableMotionIds } from "./io/broker-client";
import { CAMERA_WHEEL_SENSITIVITY, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN } from "./io/camera-settings";
import { createDevtoolsWindowOpener } from "./io/devtools-window";
import { endpointDefaultsFromConfig, mergeEndpoints } from "./io/endpoints-settings";
import { mergeGuardrails, rateLimitDefaultsFromConfig } from "./io/guardrails-settings";
import { enabledIdleVariants } from "./io/idle-motion-settings";
import { screenDefaultsFromConfig } from "./io/screen-settings";
import { createSettingsSecretProvider } from "./io/secret-provider";
import { createSettingsStores } from "./io/settings-stores";
import { createSettingsWindowOpener } from "./io/settings-window";
import { resolveScreenCapturer, resolveScreenSourceProvider } from "./io/tauri-screen";
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
import { getLocale, subscribe as subscribeLocale } from "./ui/i18n";
import { createQuickControls } from "./ui/quick-controls";
import { createSurfaces } from "./ui/surfaces";
import { createVoiceInputIndicator } from "./ui/voice-input-indicator";
import { createVoiceInputStatus } from "./ui/voice-input-status";

/** Input summon hotkey (window-focus only — global shortcuts to follow via tauri-plugin-global-shortcut). */
const SUMMON_KEY = "/";

const log = createLogger("bootstrap");

interface BootstrapHandle {
  dispose(): void;
}

async function bootstrap(): Promise<BootstrapHandle> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // Disposer collection: every long-lived resource created below registers its own teardown
  // here at its creation site, instead of a separately hand-maintained list. Drained LIFO
  // (reverse of registration) — a single hot.dispose() registration for the whole module, so
  // a later resource can never silently displace an earlier one's teardown.
  const disposers: Array<() => void> = [];
  let disposed = false;
  const register = (teardown: () => void): void => {
    if (disposed) teardown();
    else disposers.push(teardown);
  };
  const dispose = (): void => {
    disposed = true;
    let firstError: unknown;
    let failed = false;
    while (disposers.length) {
      try {
        disposers.pop()!();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  };
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(dispose);
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
  register(() => stage.removeEventListener("wheel", onWheelZoom));

  const renderer = createRenderer({ mount: stage });
  // Tier 1 ambient: backend-independent, always on. tick fires after VRM loads, so
  // starting before loadVRM is safe (frames without VRM are no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  // Read at endSpeech time — the store below is built after the surfaces mount.
  const surfaces = createSurfaces({
    mount: root,
    keepBubbleUntilDismissed: () => settingsStores.bubblePersistSettings.get().enabled,
  });
  register(() => surfaces.dispose());

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
  register(() => unsubAnchor());

  const settingsStores = createSettingsStores({ locale: getLocale() });
  const {
    screenshotSettings,
    ttsSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    workflowSettings,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    screenSettings,
    screenKnobSettings,
    lipsyncSettings,
    vadSettings,
    agentSettings,
    fillerSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    railCollapsedSettings,
    guardrailsSettings,
    bubblePersistSettings,
    chatHistoryStore,
    sessionStore,
    sessionDiagnostics,
    idleMotionSettings,
    expressMotionSettings,
  } = settingsStores;
  // Every store in the bag shares the same lifecycle, so teardown iterates the bag itself:
  // a store added to createSettingsStores is disposed without touching this loop.
  for (const store of Object.values(settingsStores)) {
    register(() => store.dispose());
  }
  // Effective endpoints with overrides layered on config.endpoints. Evaluated at call time (hot-reload friendly).
  function getEndpoints(): ReturnType<typeof config.get>["endpoints"] {
    return mergeEndpoints(config.get().endpoints, endpointsSettings.get());
  }
  // Effective guardrails with the edited caps layered on config.guardrails. Evaluated at call time.
  function getGuardrails(): ReturnType<typeof config.get>["guardrails"] {
    return mergeGuardrails(config.get().guardrails, guardrailsSettings.get());
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
  const voiceInputStatus = createVoiceInputStatus();
  register(() => voiceInputStatus.dispose());
  const screenSourceProvider = resolveScreenSourceProvider();
  const screenCapturer = resolveScreenCapturer();
  // Pop-out: Tauri uses separate WebviewWindow("settings"), otherwise browser window. Wire storage events
  // bidirectionally so main window edits are reflected here and vice versa.
  const openSettings = createSettingsWindowOpener();
  const openDevtools = createDevtoolsWindowOpener();
  // Cross-window settings sync is wired before VRM/speaker selection so those stores can broadcast
  // through the returned callback; the reload half is wired after those selections exist.
  const {
    broadcastSettings,
    onRemoteChange,
    dispose: disposeCrossWindowSync,
  } = wireCrossWindowSync({
    renderer,
    voiceInputStatus,
    stores: settingsStores,
    log,
  });
  register(() => disposeCrossWindowSync());
  const vrm = wireVrmSelection({
    renderer,
    log,
    broadcastSettings,
  });
  const { vrmSelection, loadVrmSerialized, swapVrm, importVrm } = vrm;
  register(() => vrmSelection.dispose());

  const speaker = wireSpeakerSelection({
    getEndpoints,
    getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    log,
    broadcastSettings,
  });
  const {
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    pickVoiceImport,
    commitVoiceImport,
    removeUserVoice,
    refreshVoiceList,
  } = speaker;
  register(() => speakerSelection.dispose());
  wireSettingsReload({
    onRemoteChange,
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
      bubblePersistSettings,
      presenceSettings,
      pacerGapSettings,
      rateLimitSettings: guardrailsSettings,
      getRateLimitDefaults: () => {
        try {
          return rateLimitDefaultsFromConfig(config.get().guardrails);
        } catch {
          return undefined;
        }
      },
      screenSettings,
      screenKnobSettings,
      getScreenDefaults: () => {
        try {
          return screenDefaultsFromConfig(config.get().screen);
        } catch {
          return undefined;
        }
      },
      railCollapsedSettings,
      transcript: chatHistoryStore,
      // Same instances the dispatcher reads through, so "start fresh" takes effect on the next turn.
      sessionStore,
      sessionDiagnostics,
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
      pickVoiceImport,
      commitVoiceImport,
      removeUserVoice,
      refreshVoiceList,
      onGainPreview: (mouthOpen) => renderer.setMouthOpen(mouthOpen),
      onGainPreviewEnd: () => renderer.stopMouth(),
      onOpenDevtools: openDevtools,
      // Reset the camera viewpoint to head-on (store drives renderer.setOrbit).
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      // Default instructions to show as placeholder when empty (ignored if config not loaded).
      getDefaultInstructions: () => {
        try {
          return config.get().endpoints.chat_instructions;
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
          return endpointDefaultsFromConfig(config.get().endpoints);
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
      idleMotionSettings,
      getIdlePool: () => {
        try {
          return config.get().motions.idle;
        } catch {
          return undefined;
        }
      },
      expressMotionSettings,
      getExpressMotions: () => {
        try {
          return agentTriggerableMotionIds(config.get().motions);
        } catch {
          return [];
        }
      },
      onPopOut: () => openSettings(),
    });
  // DOM surfaces re-mounted on locale change (see i18n subscriber below). Held in
  // let bindings; onActivate arrows read the live binding, so recreating is safe.
  let quickControls = buildQuickControls();
  register(() => quickControls.dispose());
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
      onOpenSettings: () => quickControls.open(undefined, { tab: "adv" }),
    });
  let captureIndicator = buildCaptureIndicator();
  register(() => captureIndicator.dispose());
  let voiceInputIndicator = buildVoiceInputIndicator();
  register(() => voiceInputIndicator.dispose());

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
  register(() => unsubscribeLocale());

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    quickControls.open({ x: e.clientX, y: e.clientY });
  }
  stage.addEventListener("contextmenu", onContextMenu);
  register(() => stage.removeEventListener("contextmenu", onContextMenu));

  // ── Dispatcher spine ──────────────────────────────────────────────────────
  // event_bus → dispatcher → backend_caller → streamChat → Hermes → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted drives this loop.
  // bus/dispatcher safe to create before config load (backend_caller reads endpoints at call time
  // from config). backend_caller needs config store, so wire after config creation.
  const bus = createEventBus({
    onDrop: (env, reason) => log.info("drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);

  // Hotkey: summon input via SUMMON_KEY when window focused. (Esc/Enter handled inside input)
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== SUMMON_KEY || e.metaKey || e.ctrlKey || e.altKey) return;
    if (surfaces.isInputOpen()) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    surfaces.summonInput();
  }
  window.addEventListener("keydown", onKeydown);
  register(() => window.removeEventListener("keydown", onKeydown));

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
  // STT/TTS key warning (prevent 401 on gated backends requiring keys).
  if (import.meta.env.DEV && !sttKeySettings.get().apiKey && !import.meta.env.VITE_YUI_STT_KEY) {
    log.warn(
      "STT API 키 미설정 — 키를 요구하는 STT 서버라면 401 가능. .env.local(VITE_YUI_STT_KEY) 참고.",
    );
  }
  if (import.meta.env.DEV && !ttsKeySettings.get().apiKey && !import.meta.env.VITE_YUI_TTS_KEY) {
    log.warn(
      "TTS API 키 미설정 — TTS 서버가 키를 요구하면 401 가능. .env.local(VITE_YUI_TTS_KEY) 참고.",
    );
  }
  try {
    const cfg = await config.load();
    if (disposed) return { dispose };
    surfaces.setAttachmentLimits(cfg.guardrails.attachments);
    const configured = await createConfiguredBootstrap(cfg, {
      config,
      renderer,
      ambient,
      surfaces,
      settings: settingsStores,
      bus,
      userInput,
      voiceInputStatus,
      screenCapturer,
      vrm,
      speaker,
      root,
      stage,
      getQuickControls: () => quickControls,
      getEndpoints,
      getGuardrails,
      isDisposed: () => disposed,
    });
    register(configured.dispose);
    if (disposed) return { dispose };
    if (import.meta.env.DEV) {
      Object.assign(globalThis as Record<string, unknown>, {
        __yuiSpeech: configured.voice.speechPlayback,
      });
      try {
        await wireDevGlobals({
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
          getDispatcher: () => configured.dispatcher,
        });
      } catch (err) {
        configured.dispose();
        throw err;
      }
      if (disposed) return { dispose };
    }
    const unsubscribeConfig = config.subscribe((cfg, changed) => {
      if (changed.has("emotionRegistry")) renderer.setEmotionRegistry(cfg.emotionRegistry);
      if (changed.has("motions")) {
        // The enabled pool is catalog ∩ overlay, so a new catalog needs the intersection redone.
        // Applied before the registry — as at boot — so the baseline it replays already honors it.
        const idlePool = cfg.motions.idle;
        if (idlePool) {
          renderer.setIdleVariants(enabledIdleVariants(idlePool, idleMotionSettings.get()));
        }
        renderer.setMotionRegistry(cfg.motions);
      }
      if (changed.has("guardrails")) {
        configured.guardrails.setConfig(getGuardrails());
        surfaces.setAttachmentLimits(cfg.guardrails.attachments);
      }
      if (changed.has("hotkeys")) void configured.summonHotkey.apply(cfg.hotkeys.summon_global);
      if (changed.has("endpoints")) void refreshVoiceList();
      configured.broker.onConfigChange(cfg, changed);
      if (!changed.has("avatar")) return;
      renderer.setFraming(cfg.avatar.framing ?? {});
      renderer.setGaze(cfg.avatar.gaze ?? {});
      const reloadAlpha = cfg.avatar.hit_test?.alpha_threshold;
      if (reloadAlpha !== undefined) renderer.setHitTestThreshold(reloadAlpha);
      vrmSelection.setManifest({
        available: cfg.avatar.available,
        defaultValue: cfg.avatar.vrm_url,
      });
      void loadVrmSerialized(vrmSelection.getActive().url).catch((err) =>
        log.error("vrm_hot_swap_failed", { error: String(err) }),
      );
    });
    register(unsubscribeConfig);
  } catch (err) {
    if (disposed) return { dispose };
    log.error("config_or_vrm_load_failed", { error: String(err) });
    // Boot failure = empty transparent window. Preserve cause (ConfigError vs VRM) visible to user (#316).
    if (!disposed) showBootError(root, err);
  }
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
    register(() => config.stop());
  }
  return { dispose };
}

/** Don't intercept hotkey if focus already on input element. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

void bootstrap();
