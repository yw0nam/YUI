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
 *   - .yui-status: status pill — capture, voice, and tool state (invisible-by-default).
 *   - .yui-ui:    overlay — speech bubble, text input (invisible-by-default).
 */

import { applyTheme } from "../ui/theme/apply-theme";
import "../styles.css";
import { createConfiguredBootstrap } from "../app/bootstrap-configured";
import { wireDevtoolsRequest } from "../app/controls/wire-devtools-request";
import { wireHelpGuide } from "../app/controls/wire-help-guide";
import { wirePetControls } from "../app/controls/wire-pet-controls";
import { wireCrossWindowSync } from "../app/cross-window/wire-cross-window";
import { wireSettingsReload } from "../app/cross-window/wire-window-sync";
import { wireCspViolationLog } from "../app/csp-violation";
import { wireDevGlobals } from "../app/dev/wire-dev-globals";
import { createDisposers } from "../app/disposers";
import { createCharacterName } from "../app/message/character-name";
import { wirePlateName } from "../app/message/wire-plate-name";
import { createPetWindowRole } from "../app/pet-windows/pet-window-role";
import { createWindowStores } from "../app/settings/window-stores";
import { wireAvatarSelection } from "../app/settings/wire-avatar";
import { createPetConfig, wireConfigReload, wireConfigWatch } from "../app/settings/wire-config";
import { wirePresetSwitch } from "../app/settings/wire-preset";
import { createBedSceneHold } from "../app/stage/bed-scene-hold";
import { createStageRenderer } from "../app/stage/stage-renderer";
import { wireInputAnchor } from "../app/stage/wire-pet-stage";
import {
  createDelegationChipMount,
  messageWindowSuppression,
} from "../app/turn/push/delegation-chip-mount";
import { createPushStores, publishPushStores } from "../app/turn/push/push-stores";
import { wirePushMode } from "../app/turn/push/wire-push";
import { createSessionResetAnnouncer } from "../app/turn/session-reset-announcer";
import { createVoiceFix } from "../app/voice/voice-fix";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../config/secrets";
import { type BusEnvelope, createEventBus } from "../dispatcher/core/event-bus";
import { createUserInputSource } from "../dispatcher/sources/user-input-source";
import { resolveScreenCapturer } from "../io/window/capture/tauri-screen";
import { createDevtoolsWindowOpener } from "../io/window/openers/devtools-window";
import { createSettingsWindowOpener } from "../io/window/openers/settings-window";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { presetIdForWindow } from "../settings/preset/active-preset";
import { readBoundPresetId } from "../settings/preset/bound-preset";
import { createUnifiedShown } from "../settings/unified/unified-shown";
import { createStatusPill } from "../ui/chips/status-pill";
import { createVoiceInputStatus } from "../ui/chips/voice-input-status";
import { showBootError } from "../ui/notices/boot-error";
import { attachSummonKey } from "../ui/surfaces/summon-key";
import { wireMessageSurfaces } from "../ui/surfaces/wire";

const log = createLogger("bootstrap");

interface BootstrapHandle {
  dispose(): void;
}

async function bootstrap(): Promise<BootstrapHandle> {
  const boundId = readBoundPresetId();
  const bound = boundId !== null;
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
  const { register, dispose: disposeWindow, isDisposed } = disposers;
  const role = createPetWindowRole({ boundId, disposeWindow, log });
  if (!role || isDisposed()) return { dispose: disposeWindow };
  const { dispose } = role;
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(dispose);
  }
  register(wireCspViolationLog());

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

  const { settingsStores, conversationStores, presetRegistry, petWindows } = createWindowStores(
    register,
    role,
  );
  register(applyTheme({ store: settingsStores.themeSettings, root: document.documentElement }));
  const petConfig = createPetConfig({ ...settingsStores, log });
  const config = petConfig.config;
  const bedSceneHold = createBedSceneHold();
  const { renderer, ambient } = createStageRenderer({
    stage,
    settings: settingsStores,
    register,
  });

  const voiceInputStatus = createVoiceInputStatus();
  register(() => voiceInputStatus.dispose());
  // Tool tells stay with the character in both window modes, so the pill backs the local surfaces.
  const statusPill = createStatusPill({
    mount: root,
    settings: settingsStores.screenshotSettings,
    voice: voiceInputStatus,
    onOpenSettings: () => openSettings(),
    onFixVoice: createVoiceFix({
      openConnection: () => openSettings("conn"),
      status: voiceInputStatus,
    }),
  });
  register(() => statusPill.dispose());

  // Cross-window settings sync is wired before VRM/speaker selection so those stores can broadcast
  // through the returned callback; the reload half is wired after those selections exist.
  const {
    broadcastSettings,
    onRemoteChange,
    bridge: windowBridge,
    dispose: disposeCrossWindowSync,
  } = wireCrossWindowSync({
    bound,
    renderer,
    voiceInputStatus,
    stores: settingsStores,
    conversation: conversationStores,
    log,
  });
  register(() => disposeCrossWindowSync());
  const unifiedShown = createUnifiedShown({
    switch: settingsStores.unifiedChatSwitch,
    onPetWindowsChanged: windowBridge.onPetWindowsChanged,
  });
  register(unifiedShown.dispose);
  const characterName = createCharacterName({
    registry: presetRegistry,
    boundId,
    agentSettings: settingsStores.agentSettings,
  });
  const { surfaces, local, remote, getMode, subscribeMode } = wireMessageSurfaces({
    boundId,
    settingsBridge: windowBridge,
    transcript: conversationStores.chatHistoryStore,
    characterName,
    mount: root,
    tool: statusPill,
    bubblePersistSettings: settingsStores.bubblePersistSettings,
    messageWindowSettings: settingsStores.messageWindowSettings,
    shown: unifiedShown,
    register,
  });
  register(
    wirePlateName({ registry: presetRegistry, plate: local.plate, boundId, name: characterName }),
  );
  register(
    wireInputAnchor({
      renderer,
      stage,
      surfaces: local,
    }),
  );

  const screenCapturer = resolveScreenCapturer();
  // Settings opens the current pet window's companion in Tauri or a browser popup.
  const openSettings = createSettingsWindowOpener(boundId, windowBridge.emitSettingsPage);
  const openDevtools = createDevtoolsWindowOpener();
  register(wireDevtoolsRequest({ bridge: windowBridge, boundId, open: openDevtools }));
  const { vrm, speaker } = wireAvatarSelection({
    renderer,
    getEndpoints: petConfig.getEndpoints,
    getTtsKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    endpointsSettings: settingsStores.endpointsSettings,
    ttsKeySettings: settingsStores.ttsKeySettings,
    config,
    log,
    broadcastSettings,
    register,
  });
  const { vrmSelection, loadVrmSerialized } = vrm;
  const { speakerSelection } = speaker;
  wireSettingsReload({
    onRemoteChange,
    vrmSelection,
    loadVrmSerialized,
    speakerSelection,
    log,
  });

  const push = createPushStores({
    getEndpoints: petConfig.getEndpoints,
    getChatKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    register,
  });
  publishPushStores(push, windowBridge, register);
  // A preset switch stops the turn and speech the way the stop button does, then reloads.
  register(
    wirePresetSwitch({
      registry: presetRegistry,
      boundId,
      bridge: windowBridge,
      onBeforeReload: push.stopTurn,
    }),
  );

  // The bus and input source come first: the settings panel submits its help requests through them.
  // The bus is safe to create before config load: it only queues until the dispatcher starts popping.
  let restoreSignals: ((env: BusEnvelope) => void) | null = null;
  const bus = createEventBus({
    onDrop: (env, reason) => {
      log.info("drop", { event_name: env.event_name, reason });
      restoreSignals?.(env);
    },
  });
  const userInput = createUserInputSource(bus);
  const help = wireHelpGuide({ userInput, bridge: windowBridge, register });
  const sessionReset = createSessionResetAnnouncer(
    windowBridge.emitSessionReset,
    presetIdForWindow(),
  );

  const quickCard = wirePetControls({
    root,
    stage,
    stores: settingsStores,
    conversation: conversationStores,
    config,
    vrm,
    speaker,
    pushSocket: push.pushSocket,
    stopTurn: push.stopTurn,
    announceSessionReset: sessionReset.announce,
    presetRegistry,
    petWindows,
    boundId,
    voiceInputStatus,
    remoteSurfaces: remote,
    openSettings,
    register,
  });

  // ── Dispatcher spine ──────────────────────────────────────────────────────
  // event_bus → dispatcher → backend_caller → streamChat → backend → ControlEnvelope →
  // renderer.applyDirective. user.text_submitted drives this loop.

  register(attachSummonKey(surfaces));

  // Config-driven load: configs/*.json → validated AppConfig. endpoints/motions etc
  // consumed during dispatcher·tts wiring. VRM displayed via avatar.vrm_url.
  try {
    const cfg = await config.load();
    characterName.setPersona(cfg.persona);
    if (isDisposed()) return { dispose };
    surfaces.setAttachmentLimits(cfg.guardrails.attachments);
    const configured = await createConfiguredBootstrap(cfg, {
      bound,
      config,
      renderer,
      ambient,
      bedSceneHold,
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
      getQuickCard: () => quickCard,
      openSettings,
      onSessionReset: windowBridge.onSessionReset,
      emitCharacterAddressed: windowBridge.emitCharacterAddressed,
      onCharacterAddressed: windowBridge.onCharacterAddressed,
      unifiedShown,
      emitUserTurnDone: windowBridge.emitUserTurnDone,
      onUserTurnRouted: windowBridge.onUserTurnRouted,
      onStopTurns: windowBridge.onStopTurns,
      pushSocket: push.pushSocket,
      delegations: push.delegations,
      delegationHistory: push.delegationHistory,
      reasoning: push.reasoning,
      getEndpoints: petConfig.getEndpoints,
      getGuardrails: petConfig.getGuardrails,
      isDisposed,
    });
    restoreSignals = configured.restoreSignals;
    register(configured.dispose);
    if (isDisposed()) return { dispose };
    help.bindInteraction(configured.noteInteraction);
    sessionReset.bindGreeting(configured.greetLocal);
    push.bind({
      vocabulary: configured.vocabulary.vocabulary,
      stopTurn: configured.stopTurn,
      windowTools: configured.windowTools,
    });
    register(
      wirePushMode({
        socket: push.pushSocket,
        chip: createDelegationChipMount({
          mount: surfaces.chipColumn,
          collapsed: configured.chipFold,
          store: push.delegations,
          pushState: push.pushSocket,
          onOpenSettings: () => openSettings("conn"),
          suppression: messageWindowSuppression({ getMode, subscribe: subscribeMode }),
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
          getQuickCard: () => quickCard,
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
        log,
      }),
    );
    const configWatch = wireConfigWatch({ config, log, register });
    // DEV-only: polling watcher runs — edits to configs/*.json reflected immediately.
    if (import.meta.env.DEV) {
      configWatch.startDev();
    }
    log.info("bootstrap_ready");
  } catch (err) {
    if (isDisposed()) return { dispose };
    log.error("config_or_vrm_load_failed", { error: String(err) });
    // The boot error card names the cause, ConfigError or VRM.
    if (!isDisposed()) showBootError(root, err);
  }
  return { dispose };
}

void bootstrap();
