import type { Tier1Engine } from "../ambient/liveliness/tier1";
import type { Sitter } from "../ambient/locomotion/sitter";
import type { AppConfig } from "../config/load";
import { isChatConfigured } from "../dispatcher/backend/backend-caller";
import type { BusEnvelope } from "../dispatcher/core/event-bus";
import type { Guardrails } from "../dispatcher/core/guardrails";
import type { Dispatcher } from "../dispatcher/dispatcher";
import { createAddressedProducer } from "../dispatcher/sources/addressed/addressed-producer";
import type { SignalsSource } from "../dispatcher/sources/inbox/signals-source";
import { createUserTurnDone } from "../dispatcher/sources/routed/user-turn-done";
import { onAvatarRpc, respondAvatarRpc } from "../io/bridge/inbox/avatar-rpc";
import type {
  CharacterAddressed,
  UserTurnDone,
  UserTurnRouted,
} from "../io/bridge/settings-bridge";
import type { ClientTool } from "../io/chat/tools/client-tools";
import { createPetWindowTools } from "../io/chat/tools/pet-window-tools";
import type { ScreenCapturer } from "../io/window/capture/screen-source-provider";
import { createFrontmostTracker } from "../io/window/frontmost-tracker";
import { createUnifiedWindowController } from "../io/window/openers/unified-window";
import type { SummonHotkey } from "../io/window/pet/summon-hotkey";
import { subscribeOsEvent } from "../io/window/tauri-listen";
import { createLogger } from "../logger";
import { mergeScreen } from "../settings/capture/screen-settings";
import type { DelegationChipSettingsStore } from "../settings/panels/delegation-chip-settings";
import { presetIdForWindow, readPresetName } from "../settings/preset/active-preset";
import type { UnifiedShown } from "../settings/unified/unified-chat-switch";
import { isMacOS, isWindows } from "../tauri-env";
import { t } from "../ui/i18n";
import { maybeShowFirstRunHint } from "../ui/notices/first-run-hint";
import { wireIngressDeadNotice } from "../ui/notices/ingress-dead-notice";
import type { createQuickControls } from "../ui/quick-controls/quick-controls";
import { wireRelations } from "./relations/wire-relations";
import { wireSignalChips } from "./signal-chips/wire-signal-chips";
import type { BedSceneHold } from "./stage/bed-scene-hold";
import { wireBedScene } from "./stage/wire-bed-scene";
import { wireStageGestures } from "./stage/wire-gestures";
import { wireLocomotion } from "./stage/wire-locomotion";
import { wireGaze, wireHitTest } from "./stage/wire-stage";
import { wirePeek, wireSummonHotkey } from "./stage/wire-summon";
import { wireWindowGeometry } from "./stage/wire-window-geometry";
import { type TurnCorePhase1, wireTurnCore } from "./turn/turn-core";
import type { wireVocabulary } from "./turn/vocabulary/wire-vocabulary";
import type { VoicePipeline } from "./turn/voice/wire-voice-pipeline";
import { wireCard } from "./turn/wire-card";
import { wireGreeting } from "./turn/wire-greeting";
import { wireDispatcherSources } from "./turn/wire-sources";
import { wireUnifiedWindow } from "./unified/wire-unified-window";

const log = createLogger("bootstrap");

/** The pet window's own handles, on top of what the chat turn reads. */
interface Phase1Handles extends TurnCorePhase1 {
  bound?: boolean;
  ambient: Tier1Engine;
  screenCapturer: ScreenCapturer;
  root: HTMLElement;
  stage: HTMLElement;
  getQuickControls(): ReturnType<typeof createQuickControls>;
  /** Subscribes to resets the preset's other windows announce. */
  onSessionReset(cb: (presetId: string) => void): () => void;
  /** Emits this window's replies that named another open character, once their playback ended. */
  emitCharacterAddressed(event: CharacterAddressed): void;
  /** Subscribes to the replies another character addressed to this preset. */
  onCharacterAddressed(cb: (event: CharacterAddressed) => void): () => void;
  /** Whether the unified chat window is shown; main opens and closes it on this. */
  unifiedShown: UnifiedShown;
  /** Emits that this preset's user turn for a send id is over, or never started. */
  emitUserTurnDone(event: UserTurnDone): void;
  /** Subscribes to the unified chat window's messages routed to a preset. */
  onUserTurnRouted(cb: (event: UserTurnRouted) => void): () => void;
  isDisposed(): boolean;
  bedSceneHold: BedSceneHold;
}

export interface ConfiguredBootstrapHandles {
  restoreSignals: (env: BusEnvelope) => void;
  voice: VoicePipeline;
  dispatcher: Dispatcher;
  guardrails: Guardrails;
  summonHotkey: SummonHotkey;
  vocabulary: Awaited<ReturnType<typeof wireVocabulary>>;
  /** The seat transitions — the dev perch plays its sit-down through it. */
  sitter: Pick<Sitter, "sitDown">;
  /** The tools beside generate_express: browser, and in main the avatar tools; none outside Tauri. */
  windowTools: readonly ClientTool[];
  /** Cancels the in-flight turn, cuts the outstanding push turns and stops the queued speech. */
  stopTurn: () => void;
  /** Resets the proactive gap, the way a typed submit does. */
  noteInteraction: () => void;
  /** Performs the card's greeting when the running session is empty. */
  greetLocal: () => void;
  /** The fold store the signal chips and the delegation chip share. */
  chipFold: DelegationChipSettingsStore;
  dispose(): void;
}

export interface ConfiguredBootstrapFactories {
  create(
    cfg: AppConfig,
    phase1: Phase1Handles,
    register: RegisterDisposer,
  ): Promise<Omit<ConfiguredBootstrapHandles, "dispose">>;
}

type RegisterDisposer = (dispose: () => void) => void;

function drain(disposers: Array<() => void>, rethrow: boolean): void {
  let firstError: unknown;
  let failed = false;
  while (disposers.length > 0) {
    try {
      disposers.pop()!();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (rethrow && failed) throw firstError;
}

const realFactories: ConfiguredBootstrapFactories = {
  async create(cfg, phase1, register) {
    const { config, renderer, surfaces, settings, bus, root, stage, getQuickControls } = phase1;
    const ensureActive = (): void => {
      if (phase1.isDisposed()) throw new Error("bootstrap disposed during configured construction");
    };
    const {
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      screenSettings,
      screenKnobSettings,
      presenceSettings,
      gazeSettings,
      climbSettings,
      fallSettings,
      hintSettings,
    } = settings;
    const { vrmSelection } = phase1.vrm;

    const bedScene = wireBedScene({
      renderer,
      ambient: phase1.ambient,
      bus,
      settings,
      hold: phase1.bedSceneHold,
      register,
      log,
    });

    const frontmostTracker = createFrontmostTracker();
    const unlistenFrontmost = await subscribeOsEvent({ onTick: frontmostTracker.onTick, log });
    if (unlistenFrontmost) register(unlistenFrontmost);

    // The stage is wired after the turn core, so the tools read the executor late-bound:
    // null until wireLocomotion has run.
    let locomotion: ReturnType<typeof wireLocomotion> | null = null;
    const relations = wireRelations({
      relationsStore: phase1.conversation.relationsStore,
      presetId: presetIdForWindow(),
      onAvatarRpc,
      respondAvatarRpc,
      register,
    });
    // The producer needs nothing from the turn core, so it exists before the tools that feed it.
    const addressed = createAddressedProducer({
      transcript: phase1.conversation.chatHistoryStore,
      selfPresetId: presetIdForWindow(),
      selfName: () => readPresetName(presetIdForWindow()),
      emit: phase1.emitCharacterAddressed,
    });
    const windowTools = createPetWindowTools({
      bound: phase1.bound === true,
      getExecutor: () => locomotion?.getAvatarExecutor() ?? null,
      screen: {
        allowRequests: () => settings.screenshotSettings.get().allowRequests,
        getWindow: () => locomotion?.frame.frameWindow() ?? null,
        listMonitors: () => locomotion?.frame.listMonitors() ?? Promise.resolve([]),
        pointsAreLogical: !isWindows(),
        capturer: phase1.screenCapturer,
      },
      browserEnabled: () => settings.browserSettings.get().enabled,
      relationsEnabled: () => settings.relationsSwitch.get().enabled,
      relations: phase1.conversation.relationsStore,
      targets: relations.targets,
      recordAddressed: addressed.record,
    });
    const card = wireCard({
      agentSettings: settings.agentSettings,
      userNameSettings: settings.userNameSettings,
      getEndpoints: phase1.getEndpoints,
      getConfig: () => config.get(),
    });
    let signals: Pick<SignalsSource, "restore"> | null = null;
    const restoreSignals = (env: BusEnvelope): void => signals?.restore(env);
    const userTurnDone = createUserTurnDone({
      presetId: presetIdForWindow,
      emit: phase1.emitUserTurnDone,
      onTurnClosed: addressed.onTurnClosed,
      onTurnDropped: restoreSignals,
    });
    const core = await wireTurnCore(cfg, phase1, {
      restoreSignals: userTurnDone.onTurnDropped,
      getCardText: card.getCardText,
      getFrontmost: () => frontmostTracker.get(),
      screenCapturer: phase1.screenCapturer,
      openQuickControls: (tab) => getQuickControls().open(undefined, { tab }),
      windowTools,
      onTurnClosed: userTurnDone.onTurnClosed,
      addressedTo: addressed.targetOf,
      voicePersistence: {
        get: () => settings.sttSettings.get().enabled,
        set: settings.sttSettings.setEnabled,
      },
      takeMessageWake: bedScene.takeMessageWake,
      onVoiceTurnStart: () => bedScene.wake("message"),
      register,
      ensureActive,
    });
    const { voice, dispatcher, guardrails, pacer } = core;
    maybeShowFirstRunHint({
      seen: () => hintSettings.get().enabled,
      markSeen: () => hintSettings.setEnabled(true),
      surfaces,
      hotkey: cfg.hotkeys.summon_global,
      isMac: isMacOS(),
      chatConfigured: isChatConfigured(phase1.getEndpoints()),
      openSettings: (tab) => getQuickControls().open(undefined, { tab }),
      t,
    });

    const peekState = await wirePeek({ bus, register, ensureActive });
    if (peekState) core.setPeek(peekState);

    core.start();
    const signalChips = wireSignalChips({
      mount: surfaces.chipColumn,
      signalHistory: phase1.conversation.signalHistoryStore,
      register,
    });
    const {
      proactiveSource,
      scheduleSource,
      agentSource,
      signalsSource,
      milestoneSource,
      screenSource,
      wakeSource,
      addressedSource,
      routedUserSource,
    } = wireDispatcherSources({
      bus,
      presenceSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      screenSettings,
      getScreenConfig: () => mergeScreen(config.get().screen, screenKnobSettings.get()),
      subscribeBusy: dispatcher.subscribeBusy,
      pipelineBusy: {
        isBusy: dispatcher.isPipelineBusy,
        subscribe: dispatcher.subscribePipelineBusy,
      },
      pacer,
      isFirstActivityHeld: bedScene.isHeld,
      onCharacterAddressed: phase1.onCharacterAddressed,
      onUserTurnRouted: phase1.onUserTurnRouted,
      submitUser: phase1.userInput.submit,
      selfPresetId: presetIdForWindow(),
      onSignalArrival: signalChips.onArrival,
    });
    signals = signalsSource;
    core.setProactiveSource(proactiveSource);
    register(proactiveSource.stop);
    register(scheduleSource.stop);
    register(agentSource.stop);
    register(signalsSource.stop);
    register(milestoneSource.stop);
    register(screenSource.stop);
    register(addressedSource.stop);
    register(routedUserSource.stop);
    const hitTest = wireHitTest({
      root,
      renderer,
      getQuickControls,
      getConfig: () => config.get().avatar.hit_test,
    });
    register(hitTest.stop);
    wireGaze({ renderer, gazeSettings, register });

    // The saved geometry applies before the faller places the window and the bed scene parks it.
    const windowGeometry = await wireWindowGeometry({ register });

    locomotion = wireLocomotion({
      bound: phase1.bound,
      bus,
      renderer,
      getConfig: () => config.get(),
      dispatcher,
      hitTest,
      peekActive: () => peekState?.active() ?? false,
      isPanelOpen: () => getQuickControls().isOpen(),
      isHeld: bedScene.isHeld,
      bed: bedScene.bed,
      fallSettings,
      climbSettings,
      agentNotifySettings,
      vrmSelection,
      onStrollEnd: (bodyReleased) => {
        if (bodyReleased) voice.resumeThinking();
      },
      windowGeometry: windowGeometry ?? undefined,
      register,
      log,
    });
    core.setStrolling(locomotion.walker);
    bedScene.start(locomotion, wakeSource.fire);

    await wireStageGestures({
      stage,
      bus,
      renderer,
      getConfig: () => config.get(),
      drainSignals: () => signalsSource.drain(),
      hitTest,
      locomotion,
      cameraSettings: settings.cameraSettings,
      onTap: () => bedScene.wake("click"),
      onDragEnd: bedScene.onDragEnd,
      isCameraLocked: bedScene.isHeld,
      isCueHeld: bedScene.isHeld,
      register,
    });
    ensureActive();

    const summonHotkey = wireSummonHotkey({
      bound: phase1.bound,
      surfaces,
      bus,
      peek: {
        active: () => peekState?.active() ?? false,
        exit: () => peekState?.exit() ?? Promise.resolve(),
      },
      accelerator: cfg.hotkeys.summon_global,
      onRegisterFailed: (accelerator) => {
        surfaces.beginSpeech();
        surfaces.pushSpeech(t("hotkey.register_failed", { accelerator }));
        surfaces.endSpeech();
      },
      log,
    });
    register(() => void summonHotkey.dispose());
    // Main alone owns the unified chat window; a bound pet window never opens it.
    if (phase1.bound !== true) {
      register(
        wireUnifiedWindow({
          shown: phase1.unifiedShown,
          window: createUnifiedWindowController(),
        }),
      );
    }
    register(wireIngressDeadNotice({ surfaces, t }));
    const { vocabulary, stopTurn } = await core.connect({
      onSubmit: () => {
        proactiveSource.noteInteraction();
        bedScene.wake("message");
      },
    });
    const greeting = wireGreeting({
      onSessionReset: phase1.onSessionReset,
      presetId: presetIdForWindow(),
      stopTurn: () => void stopTurn(),
      transcript: phase1.conversation.chatHistoryStore,
      getCard: card.getCard,
      userName: card.userName,
      speak: voice.turnOutput.speak,
    });
    register(greeting.dispose);

    return {
      restoreSignals,
      voice,
      dispatcher,
      guardrails,
      summonHotkey,
      vocabulary,
      sitter: locomotion.sitter,
      windowTools,
      stopTurn,
      noteInteraction: () => proactiveSource.noteInteraction(),
      greetLocal: greeting.greetLocal,
      chipFold: signalChips.collapsed,
    };
  },
};

export async function createConfiguredBootstrap(
  cfg: AppConfig,
  phase1: Phase1Handles,
  factories: ConfiguredBootstrapFactories = realFactories,
): Promise<ConfiguredBootstrapHandles> {
  const disposers: Array<() => void> = [];
  const register = (dispose: () => void): void => {
    disposers.push(dispose);
  };
  try {
    const configured = await factories.create(cfg, phase1, register);
    return { ...configured, dispose: () => drain(disposers, true) };
  } catch (error) {
    drain(disposers, false);
    throw error;
  }
}
