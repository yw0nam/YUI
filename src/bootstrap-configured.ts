import type { Tier1Engine } from "./ambient/tier1";
import {
  wireBroker,
  wireClimber,
  wireDispatcherSources,
  wireFaller,
  wireGuardrailsOverrides,
  wirePeekExitTriggers,
  wirePercher,
  type wireSpeakerSelection,
  wireStopControl,
  wireSummonHotkey,
  wireVoiceInput,
  type wireVrmSelection,
  wireWalker,
  wireWindowSources,
} from "./bootstrap-wiring";
import {
  type AppConfig,
  CHAT_API_KEY_SECRET,
  type ConfigStore,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "./config";
import type { EndpointsConfig, WindowRect } from "./contract";
import { createBackendCaller, isChatConfigured } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import type { EventBus } from "./dispatcher/event-bus";
import { createGuardrails, type Guardrails, type GuardrailsConfig } from "./dispatcher/guardrails";
import { createProactivePacer } from "./dispatcher/proactive-pacer";
import { createTurnLog } from "./dispatcher/turn";
import type { UserInputSource } from "./dispatcher/user-input-source";
import { initDrag, type PatGesture } from "./drag";
import { CAMERA_ORBIT_SENSITIVITY } from "./io/camera-settings";
import { selectFetch } from "./io/chat-client";
import { createClientToolRegistry, createGenerateExpressTool } from "./io/client-tools";
import { createCursorTracker } from "./io/cursor-tracker";
import { createDragHoldSource } from "./io/drag-hold-source";
import { createFrontmostTracker } from "./io/frontmost-tracker";
import { createHitTestController, type HitTestController } from "./io/hit-test";
import { enabledIdleVariants } from "./io/idle-motion-settings";
import { createPeekState } from "./io/peek-state";
import { mergeScreen } from "./io/screen-settings";
import type { ScreenCapturer } from "./io/screen-source-provider";
import { buildScreenshotBlock } from "./io/screenshot-context";
import type { SettingsStores } from "./io/settings-stores";
import type { SummonHotkey } from "./io/summon-hotkey";
import { createTapSource, type TapSource } from "./io/tap-source";
import { isTauri } from "./io/tauri-env";
import { subscribeOsEvent } from "./io/tauri-listen";
import { appendRecord } from "./io/turn-record-log";
import { createLogger } from "./logger";
import type { Renderer } from "./renderer";
import { showChainResetNotice } from "./ui/chain-reset-notice";
import { maybeShowFirstRunHint } from "./ui/first-run-hint";
import { t } from "./ui/i18n";
import { wireIngressDeadNotice } from "./ui/ingress-dead-notice";
import type { createQuickControls } from "./ui/quick-controls";
import type { Surfaces } from "./ui/surfaces";
import { routeTurnFailure, turnErrorFixAction, turnErrorMessage } from "./ui/turn-error";
import { createVoiceErrorDwell } from "./ui/voice-error-dwell";
import type { VoiceInputStatus } from "./ui/voice-input-status";
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

const log = createLogger("bootstrap");

/**
 * Overlay elements that must take OS pointer events while shown — everything else in the overlay
 * stays click-through. The bubble itself is display-only; only its dismiss button is a target.
 * The voice chip earns pointer events only in the one state where it has a fix to offer.
 */
export const INTERACTIVE_OVERLAY_SELECTORS = [
  ".yui-input.is-open",
  ".yui-bubble.is-visible .yui-bubble__close",
  '.yui-voice.is-visible[data-fix="settings"]',
] as const;

export interface Phase1Handles {
  config: ConfigStore;
  renderer: Renderer;
  ambient: Tier1Engine;
  surfaces: Surfaces;
  settings: SettingsStores;
  bus: EventBus;
  userInput: UserInputSource;
  voiceInputStatus: VoiceInputStatus;
  screenCapturer: ScreenCapturer;
  vrm: ReturnType<typeof wireVrmSelection>;
  speaker: ReturnType<typeof wireSpeakerSelection>;
  root: HTMLElement;
  stage: HTMLElement;
  getQuickControls(): ReturnType<typeof createQuickControls>;
  getEndpoints(): EndpointsConfig;
  /** Effective guardrails — the editable caps layered on configs/guardrails.json. */
  getGuardrails(): GuardrailsConfig;
  isDisposed(): boolean;
}

export interface ConfiguredBootstrapHandles {
  voice: VoicePipeline;
  dispatcher: Dispatcher;
  guardrails: Guardrails;
  summonHotkey: SummonHotkey;
  broker: Awaited<ReturnType<typeof wireBroker>>;
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

/**
 * Head-pat gesture wiring. The press holds the button and moves without starting an OS drag,
 * so the click-through hit-test stays suspended for its whole length — otherwise a move over a
 * transparent pixel flips the window to passthrough and the release never reaches the client.
 */
export function createPatGesture(deps: {
  hitTest: Pick<HitTestController, "suspend" | "resume">;
  tapSource: Pick<TapSource, "isHeadPoint" | "handlePatStart" | "handlePatEnd" | "handlePatAbort">;
  holdMs: () => number;
}): PatGesture {
  return {
    isPatPoint: deps.tapSource.isHeadPoint,
    holdMs: deps.holdMs,
    onStart: () => {
      deps.hitTest.suspend();
      deps.tapSource.handlePatStart();
    },
    onEnd: () => {
      deps.hitTest.resume();
      deps.tapSource.handlePatEnd();
    },
    onAbort: () => {
      deps.hitTest.resume();
      deps.tapSource.handlePatAbort();
    },
  };
}

/**
 * The fall a lost sit starts. A descent still inside its window survey resumes on a stale
 * list and moves the window from under the faller, so the climb lets go before the drop.
 */
export function createSitLossFall(deps: {
  getClimber: () => { cancel(): void } | null;
  faller: { drop(): void };
}): () => void {
  return () => {
    deps.getClimber()?.cancel();
    deps.faller.drop();
  };
}

const realFactories: ConfiguredBootstrapFactories = {
  async create(cfg, phase1, register) {
    const {
      config,
      renderer,
      ambient,
      surfaces,
      settings,
      bus,
      userInput,
      voiceInputStatus,
      screenCapturer,
      vrm,
      speaker,
      root,
      stage,
      getQuickControls,
      getEndpoints,
      getGuardrails,
    } = phase1;
    const ensureActive = (): void => {
      if (phase1.isDisposed()) throw new Error("bootstrap disposed during configured construction");
    };
    const {
      ttsSettings,
      sttSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      screenSettings,
      screenKnobSettings,
      presenceSettings,
      pacerGapSettings,
      contextHistory,
      lipsyncSettings,
      vadSettings,
      agentSettings,
      fillerSettings,
      sessionStore,
      sessionDiagnostics,
      chatHistoryStore,
      endpointsSettings,
      cameraSettings,
      gazeSettings,
      climbSettings,
      hintSettings,
      guardrailsSettings,
      idleMotionSettings,
      expressMotionSettings,
    } = settings;
    const { vrmSelection, loadVrmSerialized } = vrm;
    const { speakerSelection, refreshVoiceList } = speaker;

    const voiceErrorDwell = createVoiceErrorDwell(voiceInputStatus);
    register(() => voiceErrorDwell.dispose());

    // Voice creation precedes sources, so interaction notes stay late-bound across that cycle.
    let proactiveSourceRef: { noteInteraction(ts?: number): void } | null = null;
    // Dispatcher creation precedes peek wiring, so peek callbacks stay late-bound across that cycle.
    let peekStateRef: ReturnType<typeof createPeekState> | null = null;

    const voiceInput = wireVoiceInput({ voiceInputStatus, sttSettings });
    register(voiceInput.dispose);
    const turnLog = createTurnLog();
    const voice = wireVoicePipeline({
      renderer,
      surfaces,
      turnLog,
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
    register(voice.dispose);

    const frontmostTracker = createFrontmostTracker();
    const unlistenFrontmost = await subscribeOsEvent({ onTick: frontmostTracker.onTick, log });
    if (unlistenFrontmost) register(unlistenFrontmost);

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
      turnOutput: voice.turnOutput,
      reportSpokeText: (spoke) => turnLog.setSpokeText(spoke),
      onToolStatus: (state) =>
        state.state === "running"
          ? surfaces.showTool(state.tool_id ?? "")
          : state.state === "done"
            ? surfaces.finishTool()
            : surfaces.hideTool(),
      getScreenshot: async () => {
        const screenshot = settings.screenshotSettings.get();
        if (!screenshot.enabled) return undefined;
        const capture = await screenCapturer.capture(screenshot.source);
        return buildScreenshotBlock(screenshot, capture ?? undefined);
      },
      getBodyState: () => dispatcher.getBodyState(),
      getFrontmost: () => frontmostTracker.get(),
      contextHistory,
      appendTurnRecord: (record) => appendRecord(record),
      getAgentSettings: () => agentSettings.get(),
      // Built per turn from the published vocabulary, so a live edit reaches the next tool schema.
      clientTools: () => createClientToolRegistry([createGenerateExpressTool(broker.vocabulary())]),
    });
    const guardrails = createGuardrails(getGuardrails());
    const pacer = createProactivePacer({ getIntervalMs: () => pacerGapSettings.get().value });
    register(pacer.stop);
    register(pacerGapSettings.subscribe(() => pacer.noteIntervalChanged()));
    register(wireGuardrailsOverrides({ guardrails, store: guardrailsSettings, getGuardrails }));
    const dispatcher = createDispatcher({
      bus,
      renderer,
      backendCaller,
      guardrails,
      peek: {
        enter: () => peekStateRef?.enter() ?? Promise.resolve(),
        exit: () => peekStateRef?.exit() ?? Promise.resolve(),
      },
      peekConfig: () => config.get().avatar.peek,
      tapConfig: () => config.get().avatar.tap,
      turnLog,
      pacer,
      appendSkipRecord: (record) => appendRecord(record),
      onUserTurnFailed: (reason, source) => {
        voice.speakFailure(reason);
        const message = turnErrorMessage(reason);
        if (!message) return;
        const action = routeTurnFailure(source, surfaces.isInputOpen());
        if (action.kind === "show_input_error") {
          surfaces.showInputError(
            message,
            turnErrorFixAction(reason, (tab) => getQuickControls().open(undefined, { tab })),
          );
        } else if (action.kind === "voice_error") {
          voiceErrorDwell.show(reason);
        }
      },
    });
    register(() => dispatcher.stop());
    register(dispatcher.subscribeBusy((busy) => surfaces.setBusy(busy)));

    const sttVad = await voice.createSttEngine();
    voiceInput.setStt(sttVad);
    ensureActive();
    renderer.setEmotionRegistry(cfg.emotionRegistry);
    // Ambient idle pool = catalog ∩ the user's selection; applied before the registry so the
    // first baseline play already honors it, then re-applied live on every store change.
    const applyIdleVariants = (): void => {
      const pool = config.get().motions.idle;
      if (pool) renderer.setIdleVariants(enabledIdleVariants(pool, idleMotionSettings.get()));
    };
    applyIdleVariants();
    register(idleMotionSettings.subscribe(applyIdleVariants));
    renderer.setMotionRegistry(cfg.motions);
    renderer.setFraming(cfg.avatar.framing ?? {});
    renderer.setGaze(cfg.avatar.gaze ?? {});
    const bootAlpha = cfg.avatar.hit_test?.alpha_threshold;
    if (bootAlpha !== undefined) renderer.setHitTestThreshold(bootAlpha);
    vrmSelection.setManifest({
      available: cfg.avatar.available,
      defaultValue: cfg.avatar.vrm_url,
    });
    void refreshVoiceList();
    await loadVrmSerialized(vrmSelection.getActive().url);
    ensureActive();
    maybeShowFirstRunHint({
      seen: () => hintSettings.get().enabled,
      markSeen: () => hintSettings.setEnabled(true),
      surfaces,
      hotkey: cfg.hotkeys.summon_global,
      isMac: /Mac/.test(navigator.platform || navigator.userAgent),
      chatConfigured: isChatConfigured(getEndpoints()),
      t,
    });

    if (isTauri()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      ensureActive();
      const win = getCurrentWindow();
      peekStateRef = createPeekState({ getWindow: getCurrentWindow });
      register(() => void peekStateRef?.dispose());
      const disposePeekExitTriggers = await wirePeekExitTriggers({
        bus,
        peek: peekStateRef,
        win: {
          onFocusChanged: (handler) => win.onFocusChanged(handler),
          listen: (event, handler) => win.listen(event, handler),
        },
      });
      register(disposePeekExitTriggers);
      ensureActive();
    }

    dispatcher.start();
    const { proactiveSource, scheduleSource, agentSource, signalsSource, screenSource } =
      wireDispatcherSources({
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
      });
    proactiveSourceRef = proactiveSource;
    register(proactiveSource.stop);
    register(scheduleSource.stop);
    register(agentSource.stop);
    register(signalsSource.stop);
    register(screenSource.stop);
    const tapSource = createTapSource({
      bus,
      renderer,
      ambient,
      config: config.get().avatar.tap,
      drainSignals: () => signalsSource.drain(),
    });
    const dragHold = createDragHoldSource({
      bus,
      getHoldMs: () => config.get().avatar.drag_hold_ms,
      getCue: () => config.get().avatar.gesture_cues.drag_held,
    });
    register(() => dragHold.noteDragEnd());
    const interactiveRects = (): DOMRect[] => {
      const rects: DOMRect[] = [];
      for (const selector of INTERACTIVE_OVERLAY_SELECTORS) {
        const el = root.querySelector<HTMLElement>(selector);
        if (el) rects.push(el.getBoundingClientRect());
      }
      const quickControls = getQuickControls();
      if (quickControls.isOpen()) rects.push(quickControls.el.getBoundingClientRect());
      return rects;
    };
    const pointInRect = (x: number, y: number, rect: DOMRect, margin: number): boolean =>
      x >= rect.left - margin &&
      x <= rect.right + margin &&
      y >= rect.top - margin &&
      y <= rect.bottom + margin;
    const hitTest = createHitTestController({
      isOverInteractive: (xClient, yClient, marginPx) => {
        if (renderer.hitTest(xClient, yClient)) return true;
        return interactiveRects().some((rect) => pointInRect(xClient, yClient, rect, marginPx));
      },
      moveTarget: window,
      getConfig: () => config.get().avatar.hit_test ?? {},
    });
    hitTest.start();
    register(hitTest.stop);
    const cursorTracker = createCursorTracker({
      onCursor: (point) => renderer.setGazeCursor(point),
    });
    register(cursorTracker.stop);
    const applyGazeEnabled = (enabled: boolean): void => {
      renderer.setGazeEnabled(enabled);
      if (enabled) cursorTracker.start();
      else {
        cursorTracker.stop();
        renderer.setGazeCursor(null);
      }
    };
    applyGazeEnabled(gazeSettings.get().enabled);
    register(gazeSettings.subscribe((state) => applyGazeEnabled(state.enabled)));

    // Ambient walking outranks nothing: a drag or an agent command cancels a stroll at once.
    let dragging = false;
    const walker = wireWalker({
      bus,
      renderer,
      getWalkConfig: () => config.get().avatar.walk,
      getMotionKind: (id) => config.get().motions[id]?.kind,
      isPeeking: () => peekStateRef?.active() ?? false,
      isDragging: () => dragging,
      isBusy: dispatcher.isPipelineBusy,
      setHitTestMoving: (moving) => hitTest.setMoving(moving),
      log,
    });
    register(walker.dispose);
    // A reflex turn skips the thinking motion, so the motion gate alone would miss it.
    register(
      dispatcher.subscribePipelineBusy((busy) => {
        if (busy) walker.cancel();
      }),
    );

    // Set once each loop exists — the drop source and the faller are built before them.
    let climberRef: { cancel(): void } | null = null;
    let percherRef: { cancel(): void; landOn(target: WindowRect): void } | null = null;

    // A character left mid-air drops to the first surface below her; the user outranks it.
    const faller = wireFaller({
      bus,
      renderer,
      getFallConfig: () => config.get().avatar.fall,
      getMotionKind: (id) => config.get().motions[id]?.kind,
      getFloorTolerancePx: () => config.get().avatar.walk.floor_tolerance_px,
      getGestureCues: () => config.get().avatar.gesture_cues,
      setHitTestMoving: (moving) => hitTest.setMoving(moving),
      onWindowLand: (target) => percherRef?.landOn(target),
      log,
    });
    register(faller.dispose);

    const windowSources = wireWindowSources({
      bus,
      renderer,
      peekActive: () => peekStateRef?.active() ?? false,
      getPeekConfig: () => config.get().avatar.peek,
      getGestureCues: () => config.get().avatar.gesture_cues,
      agentNotifySettings,
      getPosture: () => dispatcher.getPosture(),
      getVrm: () => {
        const active = vrmSelection.getActive();
        return { id: active.id, label: active.label ?? active.id };
      },
      noteAvatarMoved: () => dispatcher.noteAvatarMoved(),
      noteAgentMove: () => {
        walker.cancel();
        faller.cancel();
        climberRef?.cancel();
        percherRef?.cancel();
      },
      onDragMiss: () => faller.drop(),
      onSitLost: createSitLossFall({ getClimber: () => climberRef, faller }),
      log,
    });
    register(windowSources.dispose);

    const percher = wirePercher({
      bus,
      renderer,
      getPerchWalkConfig: () => config.get().avatar.perch_walk,
      getJumpConfig: () => config.get().avatar.jump,
      getFallConfig: () => config.get().avatar.fall,
      getMotionKind: (id) => config.get().motions[id]?.kind,
      isBusy: dispatcher.isPipelineBusy,
      walker,
      dropSource: windowSources,
      onHostLost: () => faller.drop(),
      // A jump that loses its target leaves her mid-air, the same as a lost host does.
      onTargetLost: () => faller.drop(),
      // She walked past the edge on purpose; the drop is what she walked off for.
      onStepOff: () => faller.drop(),
      setHitTestMoving: (moving) => hitTest.setMoving(moving),
      log,
    });
    percherRef = percher;
    register(percher.dispose);

    // Ambient climbing: a wall now and then, a sit on top, then back down to the floor.
    const climber = wireClimber({
      bus,
      renderer,
      getClimbConfig: () => config.get().avatar.climb,
      getWalkConfig: () => config.get().avatar.walk,
      getMotionKind: (id) => config.get().motions[id]?.kind,
      isPeeking: () => peekStateRef?.active() ?? false,
      isDragging: () => dragging,
      isBusy: dispatcher.isPipelineBusy,
      walker,
      faller,
      dropSource: windowSources,
      setHitTestMoving: (moving) => hitTest.setMoving(moving),
      log,
    });
    climberRef = climber;
    climber.setEnabled(climbSettings.get().enabled);
    register(climbSettings.subscribe((state) => climber.setEnabled(state.enabled)));
    register(climber.dispose);

    const cleanupDrag = await initDrag(stage, {
      onClick: tapSource.handleClick,
      pat: createPatGesture({
        hitTest,
        tapSource,
        holdMs: () => config.get().avatar.tap.pat_hold_ms,
      }),
      onDragStart: () => {
        dragging = true;
        walker.cancel();
        faller.cancel();
        climber.cancel();
        percher.cancel();
        hitTest.suspend();
        dragHold.noteDragStart();
        windowSources.noteUserDrag();
        bus.push({
          source: "os_event_watcher",
          event_name: "user.drag_start",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        });
      },
      onDragEnd: () => {
        dragging = false;
        hitTest.resume();
        dragHold.noteDragEnd();
        windowSources.noteUserDragEnd();
        bus.push({
          source: "os_event_watcher",
          event_name: "user.drag_end",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        });
      },
      onOrbitStart: hitTest.suspend,
      onOrbitEnd: hitTest.resume,
      onOrbit: ({ dx, dy }) => {
        const current = cameraSettings.get();
        cameraSettings.setAzimuth(current.azimuth + dx * CAMERA_ORBIT_SENSITIVITY);
        cameraSettings.setPolar(current.polar - dy * CAMERA_ORBIT_SENSITIVITY);
      },
    });
    register(cleanupDrag);
    ensureActive();

    const summonHotkey = wireSummonHotkey({
      surfaces,
      bus,
      peek: {
        active: () => peekStateRef?.active() ?? false,
        exit: () => peekStateRef?.exit() ?? Promise.resolve(),
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
    const broker = await wireBroker({
      getConfig: config.get,
      getEndpoints,
      endpointsSettings,
      expressMotionSettings,
      log,
    });
    register(broker.dispose);
    ensureActive();
    wireStopControl({
      onStop: (callback) => surfaces.onStop(callback),
      cancel: () => dispatcher.cancel(),
      abortSpeech: () => voice.speechPlayback.abort(),
    });
    surfaces.onSubmit((text, images) => {
      userInput.submit(text, images);
      proactiveSource.noteInteraction();
    });

    return { voice, dispatcher, guardrails, summonHotkey, broker };
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
