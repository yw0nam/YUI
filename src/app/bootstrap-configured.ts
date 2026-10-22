import type { Tier1Engine } from "../ambient/liveliness/tier1";
import type { Sitter } from "../ambient/locomotion/sitter";
import type { AppConfig } from "../config/load";
import { isChatConfigured } from "../dispatcher/backend/backend-caller";
import type { Guardrails } from "../dispatcher/core/guardrails";
import type { Dispatcher } from "../dispatcher/dispatcher";
import { onAvatarRpc, respondAvatarRpc } from "../io/bridge/inbox/avatar-rpc";
import { createRelationsRpc } from "../io/bridge/inbox/relations-rpc";
import type { ClientTool } from "../io/chat/tools/client-tools";
import { createPetWindowTools } from "../io/chat/tools/pet-window-tools";
import type { ScreenCapturer } from "../io/window/capture/screen-source-provider";
import { createFrontmostTracker } from "../io/window/frontmost-tracker";
import type { SummonHotkey } from "../io/window/pet/summon-hotkey";
import { subscribeOsEvent } from "../io/window/tauri-listen";
import { createLogger } from "../logger";
import { mergeScreen } from "../settings/capture/screen-settings";
import { presetIdForWindow, readPresetName } from "../settings/preset/active-preset";
import { readOpenPresetIds } from "../settings/preset/pet-windows";
import { isMacOS, isWindows } from "../tauri-env";
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
import { wireWindowGeometry } from "./stage/wire-window-geometry";
import { type TurnCorePhase1, wireTurnCore } from "./turn/turn-core";
import type { wireVocabulary } from "./turn/vocabulary/wire-vocabulary";
import type { VoicePipeline } from "./turn/voice/wire-voice-pipeline";
import { wireDispatcherSources } from "./turn/wire-sources";

const log = createLogger("bootstrap");

/** The pet window's own handles, on top of what the chat turn reads. */
interface Phase1Handles extends TurnCorePhase1 {
  bound?: boolean;
  ambient: Tier1Engine;
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
  /** The tools beside generate_express: browser, and in main the avatar tools; none outside Tauri. */
  windowTools: readonly ClientTool[];
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
      relations: phase1.conversation.relationsStore,
      targets: () =>
        readOpenPresetIds()
          .filter((id) => id !== presetIdForWindow())
          .map((id) => ({ id, name: readPresetName(id) })),
    });
    const relationsRpc = createRelationsRpc({
      subscribe: (cb) => onAvatarRpc(cb),
      respond: (id, result) => void respondAvatarRpc(id, result),
      store: phase1.conversation.relationsStore,
    });
    relationsRpc.start();
    register(relationsRpc.stop);
    const core = await wireTurnCore(cfg, phase1, {
      getFrontmost: () => frontmostTracker.get(),
      screenCapturer: phase1.screenCapturer,
      openQuickControls: (tab) => getQuickControls().open(undefined, { tab }),
      windowTools,
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
      windowTools,
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
