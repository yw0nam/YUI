import type { Tier1Engine } from "./ambient/tier1";
import {
  wireBroker,
  wireDispatcherSources,
  wirePeekExitTriggers,
  type wireSpeakerSelection,
  wireStopControl,
  wireSummonHotkey,
  wireVoiceInput,
  type wireVrmSelection,
  wireWindowSources,
} from "./bootstrap-wiring";
import {
  type AppConfig,
  CHAT_API_KEY_SECRET,
  type ConfigStore,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "./config";
import type { EndpointsConfig } from "./contract";
import { createBackendCaller, isChatConfigured } from "./dispatcher/backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher/dispatcher";
import type { EventBus } from "./dispatcher/event-bus";
import { createGuardrails, type Guardrails } from "./dispatcher/guardrails";
import { createTurnLog } from "./dispatcher/turn";
import type { UserInputSource } from "./dispatcher/user-input-source";
import { initDrag } from "./drag";
import { CAMERA_ORBIT_SENSITIVITY } from "./io/camera-settings";
import { selectFetch } from "./io/chat-client";
import { createClientToolRegistry, createGenerateExpressTool } from "./io/client-tools";
import { createCursorTracker } from "./io/cursor-tracker";
import { createDragHoldSource } from "./io/drag-hold-source";
import { createFrontmostTracker } from "./io/frontmost-tracker";
import { createHitTestController } from "./io/hit-test";
import { createPeekState } from "./io/peek-state";
import type { ScreenCapturer } from "./io/screen-source-provider";
import { buildScreenshotBlock } from "./io/screenshot-context";
import type { SettingsStores } from "./io/settings-stores";
import type { SummonHotkey } from "./io/summon-hotkey";
import { createTapSource } from "./io/tap-source";
import { isTauri } from "./io/tauri-env";
import { subscribeOsEvent } from "./io/tauri-listen";
import { createLogger } from "./logger";
import type { Renderer } from "./renderer";
import { showChainResetNotice } from "./ui/chain-reset-notice";
import { maybeShowFirstRunHint } from "./ui/first-run-hint";
import { t } from "./ui/i18n";
import type { createQuickControls } from "./ui/quick-controls";
import type { Surfaces } from "./ui/surfaces";
import { routeTurnFailure, turnErrorFixAction, turnErrorMessage } from "./ui/turn-error";
import type { VoiceInputStatus } from "./ui/voice-input-status";
import { type VoicePipeline, wireVoicePipeline } from "./voice-pipeline-wiring";

const VOICE_TURN_ERROR_DISPLAY_MS = 3_000;
const log = createLogger("bootstrap");

/**
 * Overlay elements that must take OS pointer events while shown — everything else in the overlay
 * stays click-through. The bubble itself is display-only; only its dismiss button is a target.
 */
export const INTERACTIVE_OVERLAY_SELECTORS = [
  ".yui-input.is-open",
  ".yui-bubble.is-visible .yui-bubble__close",
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
      presenceSettings,
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
      hintSettings,
    } = settings;
    const { vrmSelection, loadVrmSerialized } = vrm;
    const { speakerSelection, refreshVoiceList } = speaker;

    let voiceTurnErrorTimer: ReturnType<typeof setTimeout> | null = null;
    register(() => {
      if (voiceTurnErrorTimer !== null) clearTimeout(voiceTurnErrorTimer);
    });

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
      getAgentSettings: () => agentSettings.get(),
      // Built per turn from the published vocabulary, so a live edit reaches the next tool schema.
      clientTools: () => createClientToolRegistry([createGenerateExpressTool(broker.vocabulary())]),
    });
    const guardrails = createGuardrails(cfg.guardrails);
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
      onUserTurnFailed: (reason, source) => {
        const message = turnErrorMessage(reason);
        if (!message) return;
        const action = routeTurnFailure(source, surfaces.isInputOpen());
        if (action.kind === "show_input_error") {
          surfaces.showInputError(
            message,
            turnErrorFixAction(reason, (tab) => getQuickControls().open(undefined, { tab })),
          );
        } else if (action.kind === "voice_error") {
          if (voiceTurnErrorTimer !== null) clearTimeout(voiceTurnErrorTimer);
          voiceInputStatus.set("error", reason);
          voiceTurnErrorTimer = setTimeout(() => {
            voiceTurnErrorTimer = null;
            if (voiceInputStatus.get().state === "error") voiceInputStatus.set("listening");
          }, VOICE_TURN_ERROR_DISPLAY_MS);
        }
      },
    });
    register(() => dispatcher.stop());
    register(dispatcher.subscribeBusy((busy) => surfaces.setBusy(busy)));

    const sttVad = await voice.createSttEngine();
    voiceInput.setStt(sttVad);
    ensureActive();
    renderer.setEmotionRegistry(cfg.emotionRegistry);
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
    const { proactiveSource, scheduleSource, agentSource, signalsSource } = wireDispatcherSources({
      bus,
      presenceSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      pipelineBusy: {
        isBusy: dispatcher.isPipelineBusy,
        subscribe: dispatcher.subscribePipelineBusy,
      },
    });
    proactiveSourceRef = proactiveSource;
    register(proactiveSource.stop);
    register(scheduleSource.stop);
    register(agentSource.stop);
    register(signalsSource.stop);
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
      log,
    });
    register(windowSources.dispose);
    const cleanupDrag = await initDrag(stage, {
      onClick: tapSource.handleClick,
      onDragStart: () => {
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
      log,
    });
    register(() => void summonHotkey.dispose());
    const broker = await wireBroker({
      getConfig: config.get,
      getEndpoints,
      endpointsSettings,
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
