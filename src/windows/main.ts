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
import { wirePetControls } from "../app/controls/wire-pet-controls";
import { wireCrossWindowSync, wireDevGlobals } from "../app/cross-window/wire-cross-window";
import { wireSettingsReload } from "../app/cross-window/wire-window-sync";
import { createDisposers } from "../app/disposers";
import { createConversationStores } from "../app/settings/conversation-stores";
import { wireSpeakerSelection, wireVrmSelection } from "../app/settings/wire-avatar";
import { createPetConfig, wireConfigReload, wireConfigWatch } from "../app/settings/wire-config";
import { wireCamera, wireInputAnchor } from "../app/stage/wire-pet-stage";
import { createDelegationChipMount, wirePushMode, wirePushStores } from "../app/turn/wire-push";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../config/load";
import { createEventBus } from "../dispatcher/core/event-bus";
import { createUserInputSource } from "../dispatcher/sources/user-input-source";
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
import { createSettingsStores } from "../settings/settings-stores";
import { createVoiceInputStatus } from "../ui/chips/voice-input-status";
import { getLocale } from "../ui/i18n";
import { showBootError } from "../ui/notices/boot-error";
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
  // Every store in the bag shares the same lifecycle, so teardown iterates the bag itself:
  // a store added to createSettingsStores is disposed without touching this loop.
  for (const store of Object.values(settingsStores)) {
    register(() => store.dispose());
  }

  const conversationStores = createConversationStores();
  for (const store of Object.values(conversationStores)) {
    register(() => store.dispose());
  }

  const petConfig = createPetConfig({
    endpointsSettings: settingsStores.endpointsSettings,
    guardrailsSettings: settingsStores.guardrailsSettings,
    chatKeySettings: settingsStores.chatKeySettings,
    sttKeySettings: settingsStores.sttKeySettings,
    ttsKeySettings: settingsStores.ttsKeySettings,
    log,
  });
  const config = petConfig.config;

  const renderer = createRenderer({ mount: stage });
  register(
    wireCamera({
      stage,
      renderer,
      cameraSettings: settingsStores.cameraSettings,
      idleThrottleSettings: settingsStores.idleThrottleSettings,
    }),
  );
  // Tier 1 ambient: backend-independent, always on. tick fires after VRM loads, so
  // starting before loadVRM is safe (frames without VRM are no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  registerRendererAndAmbientDisposal(register, renderer, ambient);

  const { surfaces, local, remote, getMode } = wireMessageSurfaces({
    mount: root,
    bubblePersistSettings: settingsStores.bubblePersistSettings,
    messageWindowSettings: settingsStores.messageWindowSettings,
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
    conversation: conversationStores,
    log,
  });
  register(() => disposeCrossWindowSync());
  const vrm = wireVrmSelection({
    renderer,
    log,
    broadcastSettings,
  });
  const { vrmSelection, loadVrmSerialized } = vrm;
  register(() => vrmSelection.dispose());

  const speaker = wireSpeakerSelection({
    getEndpoints: petConfig.getEndpoints,
    getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    log,
    broadcastSettings,
  });
  const { speakerSelection, refreshVoiceList } = speaker;
  register(() => speakerSelection.dispose());
  // Config-file edits refresh via onConfigChange below; this covers the panel's override commits.
  register(
    wireVoiceListAutoRefresh({
      subscribe: settingsStores.endpointsSettings.subscribe,
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

  const controls = wirePetControls({
    root,
    stage,
    stores: settingsStores,
    conversation: conversationStores,
    config,
    renderer,
    vrm,
    speaker,
    pushSocket: push.pushSocket,
    stopTurn: push.stopTurn,
    voiceInputStatus,
    screenSourceProvider,
    surfaces,
    remoteSurfaces: remote,
    openSettings,
    openDevtools,
    register,
  });

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
      conversation: conversationStores,
      bus,
      userInput,
      voiceInputStatus,
      screenCapturer,
      vrm,
      speaker,
      root,
      stage,
      getQuickControls: controls.get,
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
          onOpenSettings: () => controls.get().open(undefined, { tab: "adv" }),
          getMode,
          subscribeMode: settingsStores.messageWindowSettings.subscribe,
        }),
        getEndpoints: petConfig.getEndpoints,
        endpointsSettings: settingsStores.endpointsSettings,
        chatKeySettings: settingsStores.chatKeySettings,
      }),
    );
    if (import.meta.env.DEV) {
      try {
        await wireDevGlobals({
          renderer,
          ambient,
          surfaces,
          screenshotSettings: settingsStores.screenshotSettings,
          lipsyncSettings: settingsStores.lipsyncSettings,
          agentSettings: settingsStores.agentSettings,
          quickControls: controls.get(),
          speechPlayback: configured.voice.speechPlayback,
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
    register(
      wireConfigReload({
        config,
        renderer,
        surfaces,
        idleMotionSettings: settingsStores.idleMotionSettings,
        getGuardrails: petConfig.getGuardrails,
        configured,
        vrm,
        refreshVoiceList,
        log,
      }),
    );
  } catch (err) {
    if (isDisposed()) return { dispose };
    log.error("config_or_vrm_load_failed", { error: String(err) });
    // Boot failure = empty transparent window. Preserve cause (ConfigError vs VRM) visible to user (#316).
    if (!isDisposed()) showBootError(root, err);
  }
  const configWatch = wireConfigWatch({ config, log, register });
  // DEV-only: polling watcher runs — edits to configs/*.json reflected immediately.
  if (import.meta.env.DEV) {
    configWatch.startDev();
  }
  return { dispose };
}

void bootstrap();
