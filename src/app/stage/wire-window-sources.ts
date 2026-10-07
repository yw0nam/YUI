import type { GestureCuesConfig, PeekConfig } from "../../config/validators/avatar/types";
import type { Posture, WindowRect } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import {
  createWindowDropSource,
  type WindowDropSource,
} from "../../dispatcher/sources/gesture/window-drop/window-drop-source";
import { type AvatarExecutor, createAvatarExecutor } from "../../io/bridge/inbox/avatar-executor";
import { onAvatarRpc, respondAvatarRpc } from "../../io/bridge/inbox/avatar-rpc";
import {
  attachKeepOnScreen,
  type KeepOnScreenHandle,
} from "../../io/window/geometry/keep-on-screen";
import { toScreenMonitor } from "../../io/window/geometry/screen-geometry";
import { createWindowResizeSource } from "../../io/window/pet/window-resize-source";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { AgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { isTauri } from "../../tauri-env";

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
  /** A move_to left the window mid-air — the character falls from where the spot put her. */
  onRelocated: () => Promise<void>;
  /** An armed sit lost its host — the character falls from where the seat was. */
  onSitLost: () => void;
  /** The sit-down a drop plays in place before the seat is taken. */
  sitDown: () => Promise<"done" | "lost">;
  /** A scene holds the body and the window — no perch, no peek, no resize. */
  isHeld: () => boolean;
  log: Logger;
}): Pick<
  WindowDropSource,
  "adoptSit" | "armedSit" | "suspendSit" | "resumeSit" | "abandonSit" | "release"
> & {
  noteUserDrag(): void;
  noteUserDragEnd(): void;
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
    onRelocated,
    log,
  } = deps;
  let windowDropSource: WindowDropSource | null = null;
  let windowResizeSource: ReturnType<typeof createWindowResizeSource> | null = null;
  let avatarExecutor: AvatarExecutor | null = null;
  let keepOnScreen: KeepOnScreenHandle | null = null;
  // A travel's pause request that arrives before the guard exists — applied once it does.
  let pendingKeepOnScreenPaused = false;
  let disposed = false;
  const handle = {
    noteUserDrag: () => {
      avatarExecutor?.noteUserDrag();
      windowDropSource?.notePickup();
    },
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
      isHeld: deps.isHeld,
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
      isLocked: deps.isHeld,
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
      onRelocated,
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
