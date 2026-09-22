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

import "../styles.css";
import { createTier1Engine } from "../ambient/liveliness/tier1";
import { createConfiguredBootstrap } from "../app/bootstrap-configured";
import { registerRendererAndAmbientDisposal } from "../app/bootstrap-disposal";
import { wireCrossWindowSync, wireDevGlobals } from "../app/cross-window/wire-cross-window";
import { wireSettingsReload } from "../app/cross-window/wire-window-sync";
import { createDisposers } from "../app/disposers";
import { wireSpeakerSelection, wireVrmSelection } from "../app/settings/wire-avatar";
import { createPetConfig } from "../app/settings/wire-config";
import { wireCueLocaleSync } from "../app/settings/wire-cue-locale-sync";
import { wireCamera, wireInputAnchor } from "../app/stage/wire-pet-stage";
import { createDelegationChipMount, wirePushMode, wirePushStores } from "../app/turn/wire-push";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../config/load";
import { createEventBus } from "../dispatcher/core/event-bus";
import { createUserInputSource } from "../dispatcher/sources/user-input-source";
import { removeUserVrm } from "../io/assets/vrm-import";
import { agentTriggerableMotionIds } from "../io/chat/broker-client";
import { wireVoiceListAutoRefresh } from "../io/voice/voices/voice-list-refresh";
import {
  resolveScreenCapturer,
  resolveScreenSourceProvider,
} from "../io/window/capture/tauri-screen";
import { createDevtoolsWindowOpener } from "../io/window/openers/devtools-window";
import { createSettingsWindowOpener } from "../io/window/openers/settings-window";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { createRenderer } from "../renderer";
import { enabledIdleVariants } from "../settings/avatar/idle-motion-settings";
import { endpointDefaultsFromConfig } from "../settings/backend/endpoints-settings";
import { rateLimitDefaultsFromConfig } from "../settings/backend/guardrails-settings";
import { screenDefaultsFromConfig } from "../settings/capture/screen-settings";
import { createSettingsStores } from "../settings/settings-stores";
import { createCaptureIndicator } from "../ui/chips/capture-indicator";
import { createVoiceInputIndicator } from "../ui/chips/voice-input-indicator";
import { createVoiceInputStatus } from "../ui/chips/voice-input-status";
import { getLocale, subscribe as subscribeLocale } from "../ui/i18n";
import { showBootError } from "../ui/notices/boot-error";
import { createQuickControls } from "../ui/quick-controls/quick-controls";
import { attachSummonKey } from "../ui/surfaces/summon-key";
import { wireMessageSurfaces } from "../ui/surfaces/wire";

const log = createLogger("bootstrap");

interface BootstrapHandle {
  dispose(): void;
}

async function bootstrap(): Promise<BootstrapHandle> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  // Disposer collection: every long-lived resource created below registers its own teardown
  // here at its creation site, instead of a separately hand-maintained list. Drained LIFO
  // (reverse of registration) — a single hot.dispose() registration for the whole module, so
  // a later resource can never silently displace an earlier one's teardown.
  const disposers = createDisposers();
  const { register, dispose, isDisposed } = disposers;
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

  const petConfig = createPetConfig({
    endpointsSettings,
    guardrailsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    log,
  });
  const config = petConfig.config;

  const renderer = createRenderer({ mount: stage });
  register(
    wireCamera({
      stage,
      renderer,
      cameraSettings,
      idleThrottleSettings,
    }),
  );
  // Tier 1 ambient: backend-independent, always on. tick fires after VRM loads, so
  // starting before loadVRM is safe (frames without VRM are no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  registerRendererAndAmbientDisposal(register, renderer, ambient);

  const { surfaces, local, remote, getMode } = wireMessageSurfaces({
    mount: root,
    bubblePersistSettings,
    messageWindowSettings,
    register,
  });
  register(
    wireInputAnchor({
      renderer,
      stage,
      surfaces: local,
    }),
  );

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
    getEndpoints: petConfig.getEndpoints,
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
      getEndpoints: petConfig.getEndpoints,
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

  const push = wirePushStores({
    getEndpoints: petConfig.getEndpoints,
    getChatKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    bridge: windowBridge,
    register,
  });

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: root,
      pushSocket: push.pushSocket,
      stopTurn: push.stopTurn,
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
      onMessage: () => {
        if (!surfaces.isInputOpen()) surfaces.summonInput();
      },
    });
  // DOM surfaces re-mounted on locale change (see i18n subscriber below). Held in
  // let bindings; onActivate arrows read the live binding, so recreating is safe.
  let quickControls = buildQuickControls();
  register(() => quickControls.dispose());
  // A popped-out surface has no settings panel of its own; it asks this window for one.
  remote.onOpenSettings(() => quickControls.open(undefined, { tab: "adv" }));
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
  register(wireCueLocaleSync(settingsStores));
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
  try {
    const cfg = await config.load();
    if (isDisposed()) return { dispose };
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
      pushSocket: push.pushSocket,
      delegations: push.delegations,
      delegationHistory: push.delegationHistory,
      reasoning: push.reasoning,
      getEndpoints: petConfig.getEndpoints,
      getGuardrails: petConfig.getGuardrails,
      isDisposed,
    });
    register(configured.dispose);
    if (isDisposed()) return { dispose };
    push.bind({
      vocabulary: configured.broker.vocabulary,
      stopTurn: configured.stopTurn,
    });
    register(
      wirePushMode({
        socket: push.pushSocket,
        chip: createDelegationChipMount({
          mount: root,
          store: push.delegations,
          pushState: push.pushSocket,
          onOpenSettings: () => quickControls.open(undefined, { tab: "adv" }),
          getMode,
          subscribeMode: messageWindowSettings.subscribe,
        }),
        getEndpoints: petConfig.getEndpoints,
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
      if (isDisposed()) return { dispose };
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
        configured.guardrails.setConfig(petConfig.getGuardrails());
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
    if (isDisposed()) return { dispose };
    log.error("config_or_vrm_load_failed", { error: String(err) });
    // Boot failure = empty transparent window. Preserve cause (ConfigError vs VRM) visible to user (#316).
    if (!isDisposed()) showBootError(root, err);
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
