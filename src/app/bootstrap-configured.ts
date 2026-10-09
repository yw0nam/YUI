import type { Tier1Engine } from "../ambient/liveliness/tier1";
import type { Sitter } from "../ambient/locomotion/sitter";
import type { AppConfig } from "../config/load";
import { isChatConfigured } from "../dispatcher/backend/backend-caller";
import type { Guardrails } from "../dispatcher/core/guardrails";
import type { Dispatcher } from "../dispatcher/dispatcher";
import type { ScreenCapturer } from "../io/window/capture/screen-source-provider";
import { createFrontmostTracker } from "../io/window/frontmost-tracker";
import type { SummonHotkey } from "../io/window/pet/summon-hotkey";
import { subscribeOsEvent } from "../io/window/tauri-listen";
import { createLogger } from "../logger";
import { mergeScreen } from "../settings/capture/screen-settings";
import { t } from "../ui/i18n";
import { maybeShowFirstRunHint } from "../ui/notices/first-run-hint";
import { wireIngressDeadNotice } from "../ui/notices/ingress-dead-notice";
import type { createQuickControls } from "../ui/quick-controls/quick-controls";
import type { BedSceneHold } from "./stage/bed-scene-hold";
import { wireBedScene } from "./stage/wire-bed-scene";
import { wireStageGestures } from "./stage/wire-gestures";
import { wireLocomotion } from "./stage/wire-locomotion";
import { wireGaze, wireHitTest } from "./stage/wire-stage";
import { wirePeek, wireSummonHotkey } from "./stage/wire-summon";
import { type TurnCorePhase1, wireTurnCore } from "./turn/turn-core";
import type { wireVocabulary } from "./turn/vocabulary/wire-vocabulary";
import type { VoicePipeline } from "./turn/voice/wire-voice-pipeline";
import { wireDispatcherSources } from "./turn/wire-sources";

const log = createLogger("bootstrap");

/** The pet window's own handles, on top of what the chat turn reads. */
interface Phase1Handles extends TurnCorePhase1 {
  ambient: Tier1Engine;
  applyCamera(): void;
  screenCapturer: ScreenCapturer;
  root: HTMLElement;
  stage: HTMLElement;
  getQuickControls(): ReturnType<typeof createQuickControls>;
  isDisposed(): boolean;
  bedSceneHold: BedSceneHold;
}

export interface ConfiguredBootstrapHandles {
  voice: VoicePipeline;
  dispatcher: Dispatcher;
  guardrails: Guardrails;
  summonHotkey: SummonHotkey;
  vocabulary: Awaited<ReturnType<typeof wireVocabulary>>;
  /** The seat transitions — the dev perch plays its sit-down through it. */
  sitter: Pick<Sitter, "sitDown">;
  /** Cancels the in-flight turn, cuts the outstanding push turns and stops the queued speech. */
  stopTurn: () => void;
  /** Resets the proactive gap, the way a typed submit does. */
  noteInteraction: () => void;
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
      applyCamera: phase1.applyCamera,
      hold: phase1.bedSceneHold,
      register,
      log,
    });

    const frontmostTracker = createFrontmostTracker();
    const unlistenFrontmost = await subscribeOsEvent({ onTick: frontmostTracker.onTick, log });
    if (unlistenFrontmost) register(unlistenFrontmost);

    const core = await wireTurnCore(cfg, phase1, {
      getFrontmost: () => frontmostTracker.get(),
      screenCapturer: phase1.screenCapturer,
      openQuickControls: (tab) => getQuickControls().open(undefined, { tab }),
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
      isMac: /Mac/.test(navigator.platform || navigator.userAgent),
      chatConfigured: isChatConfigured(phase1.getEndpoints()),
      t,
    });

    const peekState = await wirePeek({ bus, register, ensureActive });
    if (peekState) core.setPeek(peekState);

    core.start();
    const {
      proactiveSource,
      scheduleSource,
      agentSource,
      signalsSource,
      milestoneSource,
      screenSource,
      wakeSource,
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
    });
    core.setProactiveSource(proactiveSource);
    register(proactiveSource.stop);
    register(scheduleSource.stop);
    register(agentSource.stop);
    register(signalsSource.stop);
    register(milestoneSource.stop);
    register(screenSource.stop);
    const hitTest = wireHitTest({
      root,
      renderer,
      getQuickControls,
      getConfig: () => config.get().avatar.hit_test,
    });
    register(hitTest.stop);
    wireGaze({ renderer, gazeSettings, register });

    const locomotion = wireLocomotion({
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
    register(wireIngressDeadNotice({ surfaces, t }));
    const { vocabulary, stopTurn } = await core.connect({
      onSubmit: () => {
        proactiveSource.noteInteraction();
        bedScene.wake("message");
      },
    });

    return {
      voice,
      dispatcher,
      guardrails,
      summonHotkey,
      vocabulary,
      sitter: locomotion.sitter,
      stopTurn,
      noteInteraction: () => proactiveSource.noteInteraction(),
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
