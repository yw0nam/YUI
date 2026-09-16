import type { GestureCuesConfig, PeekConfig, ScreenConfig } from "../config/load";
import type { Posture, WindowRect } from "../contract";
import { createAgentSource } from "../dispatcher/agent-source";
import type { EventBus } from "../dispatcher/event-bus";
import { createMilestoneSource, type MilestoneSource } from "../dispatcher/milestone-source";
import type { ProactivePacer } from "../dispatcher/proactive-pacer";
import { createProactiveSource, type ProactiveSource } from "../dispatcher/proactive-source";
import { createScheduleSource, type ScheduleSource } from "../dispatcher/schedule-source";
import { createScreenSource, type ScreenSource } from "../dispatcher/screen-source";
import { createSignalsSource, type SignalsSource } from "../dispatcher/signals-source";
import { type AvatarExecutor, createAvatarExecutor } from "../io/bridge/avatar-executor";
import { onAvatarRpc, respondAvatarRpc } from "../io/bridge/avatar-rpc";
import { appendRecord } from "../io/chat/turn-record-log";
import type { AgentNotifySettings } from "../io/settings/agent-notify-settings";
import type { ClampedIntSettingsStore } from "../io/settings/persisted-store";
import type { ProactiveSettings } from "../io/settings/proactive-settings";
import type { ScheduleSettings } from "../io/settings/schedule-settings";
import { attachKeepOnScreen, type KeepOnScreenHandle } from "../io/window/keep-on-screen";
import { toScreenMonitor } from "../io/window/screen-geometry";
import { isTauri } from "../io/window/tauri-env";
import { createWindowDropSource } from "../io/window/window-drop-source";
import { createWindowResizeSource } from "../io/window/window-resize-source";
import type { Logger } from "../logger";
import type { Renderer } from "../renderer";

/**
 * Window-sit drop + ctrl+wheel resize producers, the agent loopback ingress bind, and the
 * avatar RPC executor that answers the ingress's `/avatar/*` bridge.
 * Tauri-only — getCurrentWindow()/invoke/listen require the Tauri runtime; in a plain browser
 * (Vite dev) this is skipped so bootstrap continues. The returned handle owns teardown and
 * forwards user-drag interruption once the asynchronous Tauri executor is ready.
 */
export function wireWindowSources(deps: {
  bus: EventBus;
  renderer: Renderer;
  peekActive: () => boolean;
  getPeekConfig: () => PeekConfig;
  getGestureCues: () => GestureCuesConfig;
  agentNotifySettings: { get(): AgentNotifySettings };
  /** Current physical posture, for the avatar RPC state answer. */
  getPosture: () => Posture;
  /** Currently loaded VRM, for the avatar RPC state answer. */
  getVrm: () => { id: string; label: string } | null;
  /** Record that the avatar just relocated on its own — a successful move_to restamps posture. */
  noteAvatarMoved: () => void;
  /** An agent command is taking the avatar — ambient motion yields to it. Its return
   *  value, when a promise, resolves once a travel that motion parked has settled. */
  noteAgentMove: () => void | Promise<void>;
  /** A drag release that caught nothing — the character falls from where she hangs. */
  onDragMiss: () => void;
  /** An armed sit lost its host — the character falls from where the seat was. */
  onSitLost: () => void;
  /** The sit-down a drop plays in place before the seat is taken. */
  sitDown: () => Promise<"done" | "lost">;
  log: Logger;
}): {
  noteUserDrag(): void;
  noteUserDragEnd(): void;
  /** Track a sit the character climbed to herself, without pushing a drop envelope. */
  adoptSit(
    windowNumber: number,
    rect: { x: number; y: number },
    charHpx: number,
    origin: "commit" | "adopt",
  ): void;
  /** The window an armed sit is held on. null when nothing, or a peek, is armed. */
  armedSit(): { windowNumber: number; origin: "commit" | "adopt"; charHpx: number } | null;
  suspendSit(): ReturnType<ReturnType<typeof createWindowDropSource>["suspendSit"]>;
  resumeSit(edgeLocalYpx: number): void;
  /** Drop a suspended sit for good, without publishing an exit. */
  abandonSit(): void;
  /** Release the armed perch and push the sit exit. */
  release(): void;
  /** Pause the keep-on-screen guard while a travel parks the window itself. */
  setKeepOnScreenPaused(paused: boolean): void;
  dispose(): void;
} {
  const {
    bus,
    renderer,
    peekActive,
    getPeekConfig,
    getGestureCues,
    agentNotifySettings,
    getPosture,
    getVrm,
    noteAvatarMoved,
    noteAgentMove,
    log,
  } = deps;
  let windowDropSource: ReturnType<typeof createWindowDropSource> | null = null;
  let windowResizeSource: ReturnType<typeof createWindowResizeSource> | null = null;
  let avatarExecutor: AvatarExecutor | null = null;
  let keepOnScreen: KeepOnScreenHandle | null = null;
  // A travel's pause request that arrives before the guard exists — applied once it does.
  let pendingKeepOnScreenPaused = false;
  let disposed = false;
  const handle = {
    noteUserDrag: () => avatarExecutor?.noteUserDrag(),
    noteUserDragEnd: () => avatarExecutor?.noteUserDragEnd(),
    adoptSit: (
      windowNumber: number,
      rect: { x: number; y: number },
      charHpx: number,
      origin: "commit" | "adopt",
    ) => windowDropSource?.adoptSit(windowNumber, rect, charHpx, origin),
    armedSit: () => windowDropSource?.armedSit() ?? null,
    suspendSit: () => windowDropSource?.suspendSit() ?? null,
    resumeSit: (edgeLocalYpx: number) => windowDropSource?.resumeSit(edgeLocalYpx),
    abandonSit: () => windowDropSource?.abandonSit(),
    release: () => windowDropSource?.release(),
    setKeepOnScreenPaused: (paused: boolean) => {
      pendingKeepOnScreenPaused = paused;
      keepOnScreen?.setPaused(paused);
    },
    dispose: () => {
      disposed = true;
      windowDropSource?.stop();
      windowResizeSource?.stop();
      avatarExecutor?.stop();
      keepOnScreen?.dispose();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Only bind loopback ingress when watcher on. Restart-to-apply:
    // toggling enable/port takes effect on next launch (no live rebind).
    if (agentNotifySettings.get().enabled) {
      void invoke("start_agent_ingress", { port: agentNotifySettings.get().port }).catch((e) =>
        log.warn("start_agent_ingress_failed", { error: String(e) }),
      );
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { listen } = await import("@tauri-apps/api/event");
    const { LogicalPosition, LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
    windowDropSource = createWindowDropSource({
      bus,
      renderer,
      invoke: (cmd) => invoke(cmd) as Promise<WindowRect[]>,
      // Position setter included: the programmatic placement path moves the window
      // itself, so the drop source owns both halves of the perch geometry.
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          scaleFactor: () => win.scaleFactor(),
          setPositionPhysical: (x, y) => win.setPosition(new PhysicalPosition(x, y)),
        };
      },
      listen: listen as never,
      peekActive,
      getPeekConfig,
      getGestureCues,
      onDragMiss: deps.onDragMiss,
      onSitLost: deps.onSitLost,
      sitDown: deps.sitDown,
    });
    windowResizeSource = createWindowResizeSource({
      renderer,
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          outerSize: () => win.outerSize(),
          scaleFactor: () => win.scaleFactor(),
          async setBoundsLogical(pos, size) {
            await win.setSize(new LogicalSize(size.width, size.height));
            await win.setPosition(new LogicalPosition(pos.x, pos.y));
          },
        };
      },
    });
    // Avatar RPC: the loopback ingress bridges `/avatar/*` here, where the state
    // lives and the movement happens. Perch gestures go through the drop source's
    // placement so they share the drag flow's geometry, arming and envelopes.
    const { availableMonitors } = await import("@tauri-apps/api/window");
    avatarExecutor = createAvatarExecutor({
      subscribe: (cb) => onAvatarRpc(cb),
      respond: (id, result) => void respondAvatarRpc(id, result),
      perch: windowDropSource,
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          outerSize: () => win.outerSize(),
          scaleFactor: () => win.scaleFactor(),
          setPositionLogical: (x, y) => win.setPosition(new LogicalPosition(x, y)),
        };
      },
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getFeetOffsetPx: () => renderer.getCharacterAnchor()?.y ?? null,
      getPosture,
      getVrm,
      noteAvatarMoved,
      noteAgentMove,
    });
    if (disposed) {
      windowDropSource.stop();
      return;
    }
    await windowDropSource.start();
    if (disposed) {
      windowDropSource.stop();
      return;
    }
    windowResizeSource.start();
    avatarExecutor.start();
    keepOnScreen = await attachKeepOnScreen(
      {
        outerPosition: () => getCurrentWindow().outerPosition(),
        outerSize: () => getCurrentWindow().outerSize(),
        setPositionPhysical: (x, y) => getCurrentWindow().setPosition(new PhysicalPosition(x, y)),
        onMoved: (cb) => getCurrentWindow().onMoved(() => cb()),
        onResized: (cb) => getCurrentWindow().onResized(() => cb()),
      },
      async () => (await availableMonitors()).map(toScreenMonitor),
    );
    if (pendingKeepOnScreenPaused) keepOnScreen.setPaused(true);
    if (disposed) keepOnScreen.dispose();
  })().catch((err) =>
    log.warn("window_drop_source_start_failed", {
      degrade: true,
      error: String(err),
    }),
  );
  return handle;
}

/** The busy predicate a buffered-inbox source takes: the pipeline's own, plus the global gap. */
interface PacedPipelineBusy {
  isBusy: () => boolean;
  subscribe: (cb: (busy: boolean) => void) => () => void;
}

/**
 * Compose pipeline-busy with the global proactive gap. The buffered-inbox sources hold their
 * items instead of skipping them, so a held window reads as busy and its opening is the
 * busy→idle edge that flushes one catchup.
 */
export function composePacedPipelineBusy(deps: {
  pipelineBusy: PacedPipelineBusy;
  pacer: Pick<ProactivePacer, "isHolding" | "subscribe">;
}): PacedPipelineBusy {
  const { pipelineBusy, pacer } = deps;
  const paced: PacedPipelineBusy = {
    isBusy: () => pipelineBusy.isBusy() || pacer.isHolding(),
    subscribe: (cb) => {
      const unsubscribeBusy = pipelineBusy.subscribe(() => cb(paced.isBusy()));
      const unsubscribePacer = pacer.subscribe(() => cb(paced.isBusy()));
      return () => {
        unsubscribeBusy();
        unsubscribePacer();
      };
    },
  };
  return paced;
}

/**
 * tier2 utterance candidate sources: proactive.<id> (idle dramatization) + schedule.<id>
 * (time-of-day greeting) + agent.done/needs_input/catchup + signals.push/batch/catchup +
 * time_milestone.first_activity (first present tick of the local day), all over the
 * presence gate.
 * Created and started; the started refs are returned for interaction-notes and teardown.
 */
export function wireDispatcherSources(deps: {
  bus: EventBus;
  presenceSettings: Pick<ClampedIntSettingsStore, "get">;
  proactiveSettings: { get(): ProactiveSettings };
  scheduleSettings: { get(): ScheduleSettings };
  agentNotifySettings: { get(): AgentNotifySettings };
  screenSettings: { get(): { enabled: boolean } };
  getScreenConfig: () => ScreenConfig;
  /** Dispatcher in-flight busy edges — anchors the screen source's quiet-after-turn window. */
  subscribeBusy: (cb: (busy: boolean) => void) => () => void;
  pipelineBusy: PacedPipelineBusy;
  /** Global proactive gap — a hold reads as a skip to the screen source and as busy to the inboxes. */
  pacer: Pick<ProactivePacer, "isHolding" | "subscribe">;
}): {
  proactiveSource: ProactiveSource;
  scheduleSource: ScheduleSource;
  agentSource: ReturnType<typeof createAgentSource>;
  signalsSource: SignalsSource;
  milestoneSource: MilestoneSource;
  screenSource: ScreenSource;
} {
  const {
    bus,
    presenceSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    screenSettings,
    getScreenConfig,
    subscribeBusy,
    pipelineBusy,
    pacer,
  } = deps;
  const pacedPipelineBusy = composePacedPipelineBusy({ pipelineBusy, pacer });
  const proactiveSource = createProactiveSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getCues: () => proactiveSettings.get().entries,
    isEnabled: () => proactiveSettings.get().enabled,
  });
  void proactiveSource.start();
  const scheduleSource = createScheduleSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getCues: () => scheduleSettings.get().entries,
    isEnabled: () => scheduleSettings.get().enabled,
  });
  void scheduleSource.start();
  const agentSource = createAgentSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
  });
  void agentSource.start();
  const signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
  });
  void signalsSource.start();
  const milestoneSource = createMilestoneSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => scheduleSettings.get().enabled,
    drainSignals: () => signalsSource.drain(),
  });
  void milestoneSource.start();
  const screenSource = createScreenSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getConfig: getScreenConfig,
    isEnabled: () => screenSettings.get().enabled,
    noteInteraction: proactiveSource.noteInteraction,
    subscribeBusy,
    isPacerHolding: pacer.isHolding,
    appendSkipRecord: (record) => appendRecord(record),
  });
  void screenSource.start();
  return {
    proactiveSource,
    scheduleSource,
    agentSource,
    signalsSource,
    milestoneSource,
    screenSource,
  };
}
