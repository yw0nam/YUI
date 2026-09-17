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
import { createConfiguredBootstrap } from "./app/bootstrap-configured";
import { wireSpeakerSelection, wireVrmSelection } from "./app/wire-avatar";
import { wireCrossWindowSync, wireDevGlobals } from "./app/wire-cross-window";
import { wirePushMode } from "./app/wire-push";
import { wireSettingsReload } from "./app/wire-window-sync";
import { CHAT_API_KEY_SECRET, STT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "./config/load";
import { createConfigStore } from "./config/store";
import { createEventBus } from "./dispatcher/core/event-bus";
import { createUserInputSource } from "./dispatcher/sources/user-input-source";
import { removeUserVrm } from "./io/assets/vrm-import";
import { publishDelegations } from "./io/bridge/delegations-bridge";
import { createDelegationsStore } from "./io/bridge/delegations-store";
import { createMessageBridge } from "./io/bridge/message-bridge";
import { createRemoteSurfaces } from "./io/bridge/message-remote";
import { publishPushSocket } from "./io/bridge/push-socket-bridge";
import { publishReasoning } from "./io/bridge/reasoning-bridge";
import { createReasoningStore } from "./io/bridge/reasoning-store";
import { agentTriggerableMotionIds, type BrokerPayload } from "./io/chat/broker-client";
import { createPushSocket, pushVocabularyOf } from "./io/chat/push-socket";
import { createSettingsSecretProvider } from "./io/chat/secret-provider";
import {
  CAMERA_WHEEL_SENSITIVITY,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
} from "./io/settings/camera-settings";
import { createChatIdSettings, localStorageChatIdStorage } from "./io/settings/chat-id-settings";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "./io/settings/delegation-chip-settings";
import { endpointDefaultsFromConfig, mergeEndpoints } from "./io/settings/endpoints-settings";
import { mergeGuardrails, rateLimitDefaultsFromConfig } from "./io/settings/guardrails-settings";
import { enabledIdleVariants } from "./io/settings/idle-motion-settings";
import type { MessageWindowMode } from "./io/settings/message-window-settings";
import { screenDefaultsFromConfig } from "./io/settings/screen-settings";
import { createSettingsStores } from "./io/settings/settings-stores";
import { wireVoiceListAutoRefresh } from "./io/voice/voice-list-refresh";
import { createDevtoolsWindowOpener } from "./io/window/devtools-window";
import { createMessageWindowController, listenTrayToggle } from "./io/window/message-window";
import { wireMessageWindowMode } from "./io/window/message-window-mode";
import { createSettingsWindowOpener } from "./io/window/settings-window";
import { isTauri } from "./io/window/tauri-env";
import { resolveScreenCapturer, resolveScreenSourceProvider } from "./io/window/tauri-screen";
import { createLogger, initLogger } from "./logger";
import { createRenderer } from "./renderer";
import { nextZoom } from "./renderer/geometry/camera-fit";
import { createCaptureIndicator } from "./ui/chips/capture-indicator";
import { createDelegationChip } from "./ui/chips/delegation-chip";
import { createVoiceInputIndicator } from "./ui/chips/voice-input-indicator";
import { createVoiceInputStatus } from "./ui/chips/voice-input-status";
import { getLocale, subscribe as subscribeLocale } from "./ui/i18n";
import { showBootError } from "./ui/notices/boot-error";
import { createQuickControls } from "./ui/quick-controls/quick-controls";
import {
  INPUT_ANCHOR_EPSILON_PX,
  INPUT_ANCHOR_MIN_BOTTOM_PX,
  INPUT_FEET_GAP_PX,
  inputBottomFromAnchor,
} from "./ui/surfaces/anchor";
import { attachSummonKey } from "./ui/surfaces/summon-key";
import { createSurfaces } from "./ui/surfaces/surfaces";
import { createSurfacesRouter } from "./ui/surfaces/surfaces-router";

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
  // Read at endSpeech time — the stores below are built after the surfaces mount.
  const localSurfaces = createSurfaces({
    mount: root,
    keepBubbleUntilDismissed: () => settingsStores.bubblePersistSettings.get().enabled,
    onPop: () => settingsStores.messageWindowSettings.setMode("popped"),
  });

  // Anchor chat input to character's feet (follow reframe). Each frame, receive feet screen coordinates,
  // map to input bottom offset, skip changes below epsilon to reduce var rewrites.
  let lastInputBottom: number | null = null;
  const unsubAnchor = renderer.onTick(() => {
    const a = renderer.getCharacterAnchor();
    if (!a) {
      if (lastInputBottom !== null) {
        localSurfaces.setInputAnchor(null);
        lastInputBottom = null;
      }
      return;
    }
    const bottom = inputBottomFromAnchor(a.y, stage.clientHeight || 1, {
      gap: INPUT_FEET_GAP_PX,
      minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX,
    });
    if (lastInputBottom === null || Math.abs(bottom - lastInputBottom) > INPUT_ANCHOR_EPSILON_PX) {
      localSurfaces.setInputAnchor(bottom);
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
    climbSettings,
    fallSettings,
    railCollapsedSettings,
    sectionsSettings,
    guardrailsSettings,
    bubblePersistSettings,
    messageWindowSettings,
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
  // One Surfaces for every consumer: the bubble and the input follow the message-window
  // mode, everything anchored to the character stays in this window.
  const messageBridge = createMessageBridge(undefined, { windowKind: "pet" });
  register(() => messageBridge.dispose());
  const remoteSurfaces = createRemoteSurfaces(messageBridge);
  // A stale popped mode must not strand speech in a window the browser build cannot open.
  const messageMode = (): MessageWindowMode =>
    isTauri() ? messageWindowSettings.get().mode : "docked";
  const surfaces = createSurfacesRouter({
    local: localSurfaces,
    remote: remoteSurfaces,
    getMode: messageMode,
    subscribeMode: (cb) => messageWindowSettings.subscribe(() => cb(messageMode())),
  });
  register(() => surfaces.dispose());
  register(
    wireMessageWindowMode({
      store: messageWindowSettings,
      remote: remoteSurfaces,
      window: createMessageWindowController(messageWindowSettings),
      listenTrayToggle,
      getMode: messageMode,
    }),
  );
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
    bridge: windowBridge,
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
    removeVoice,
    refreshVoiceList,
  } = speaker;
  register(() => speakerSelection.dispose());
  // Config-file edits refresh via onConfigChange below; this covers the panel's override commits.
  register(
    wireVoiceListAutoRefresh({
      subscribe: endpointsSettings.subscribe,
      getEndpoints,
      refresh: refreshVoiceList,
    }),
  );
  wireSettingsReload({
    onRemoteChange,
    vrmSelection,
    loadVrmSerialized,
    speakerSelection,
    log,
  });

  // One WebSocket carries turns out and finished replies in while the chat protocol is push. It is
  // inert until connect(), which runs once the configured bootstrap has a vocabulary to advertise.
  let publishedVocabulary: (() => BrokerPayload) | null = null;
  const chatIdSettings = createChatIdSettings({ storage: localStorageChatIdStorage() });
  const pushSocket = createPushSocket({
    chatBaseUrl: () => getEndpoints().chat_base_url,
    chatId: () => chatIdSettings.get().chat_id,
    getKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    vocabulary: () => pushVocabularyOf(publishedVocabulary?.()),
  });
  register(pushSocket.dispose);
  register(chatIdSettings.dispose);
  // The backend's delegations frames land here; the chip and the settings mirror both read it.
  const delegations = createDelegationsStore();
  // The backend's reasoning deltas land here; the message window's chip mirrors it.
  const reasoning = createReasoningStore();
  // The panel's session reset stops the running turn the way the stop button does; the shared
  // closure exists once the configured bootstrap has wired it.
  let stopTurn: () => void = () => {};
  // The settings window has no socket of its own: it reads this one and asks it to reset.
  register(
    publishPushSocket({ socket: pushSocket, stopTurn: () => stopTurn(), bridge: windowBridge }),
  );
  // The delegations list rides the same bridge; a fresh settings window asks for the current list.
  register(publishDelegations({ store: delegations, bridge: windowBridge }));
  register(publishReasoning({ store: reasoning, bridge: windowBridge }));

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: root,
      pushSocket,
      stopTurn: () => stopTurn(),
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      climbSettings,
      fallSettings,
      proactiveSettings,
      scheduleSettings,
      workflowSettings,
      agentNotifySettings,
      bubblePersistSettings,
      messageWindowSettings,
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
      sectionsSettings,
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
      removeVoice,
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
  // A popped-out surface has no settings panel of its own; it asks this window for one.
  remoteSurfaces.onOpenSettings(() => quickControls.open(undefined, { tab: "adv" }));
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
  // event_bus → dispatcher → backend_caller → streamChat → backend → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted drives this loop.
  // bus/dispatcher safe to create before config load (backend_caller reads endpoints at call time
  // from config). backend_caller needs config store, so wire after config creation.
  const bus = createEventBus({
    onDrop: (env, reason) => log.info("drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);

  register(attachSummonKey(surfaces));

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
    log.warn("chat_key_missing", { env: "VITE_YUI_CHAT_KEY" });
  }
  // STT/TTS key warning (prevent 401 on gated backends requiring keys).
  if (import.meta.env.DEV && !sttKeySettings.get().apiKey && !import.meta.env.VITE_YUI_STT_KEY) {
    log.warn("stt_key_missing", { env: "VITE_YUI_STT_KEY" });
  }
  if (import.meta.env.DEV && !ttsKeySettings.get().apiKey && !import.meta.env.VITE_YUI_TTS_KEY) {
    log.warn("tts_key_missing", { env: "VITE_YUI_TTS_KEY" });
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
      pushSocket,
      delegations,
      reasoning,
      getEndpoints,
      getGuardrails,
      isDisposed: () => disposed,
    });
    register(configured.dispose);
    if (disposed) return { dispose };
    publishedVocabulary = configured.broker.vocabulary;
    stopTurn = configured.stopTurn;
    // Only push mode carries a delegations list; the chip draws whatever the socket feeds the store.
    let chip: ReturnType<typeof createDelegationChip> | null = null;
    let chipCollapsed: ReturnType<typeof createDelegationChipSettings> | null = null;
    let offChipMode: (() => void) | null = null;
    register(
      wirePushMode({
        socket: pushSocket,
        chip: {
          create: () => {
            chipCollapsed = createDelegationChipSettings({
              storage: localStorageDelegationChipStorage(),
            });
            chip = createDelegationChip({
              mount: root,
              store: delegations,
              collapsed: chipCollapsed,
              pushState: pushSocket,
              onOpenSettings: () => quickControls.open(undefined, { tab: "adv" }),
              suppressed: messageMode() === "popped",
            });
            offChipMode = messageWindowSettings.subscribe(() =>
              chip?.setSuppressed(messageMode() === "popped"),
            );
          },
          dispose: () => {
            offChipMode?.();
            offChipMode = null;
            chip?.dispose();
            chipCollapsed?.dispose();
            chip = null;
            chipCollapsed = null;
          },
        },
        getEndpoints,
        endpointsSettings,
        chatKeySettings,
      }),
    );
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
          sitDown: () => configured.sitter.sitDown(null),
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
      renderer.setFraming(cfg.avatar.framing);
      renderer.setGaze(cfg.avatar.gaze);
      renderer.setHitTestThreshold(cfg.avatar.hit_test.alpha_threshold);
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

void bootstrap();
