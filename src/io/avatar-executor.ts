/**
 * avatar-executor — answers the bridged avatar RPCs from live client state.
 *
 * Execution only, no judgment: the executor never decides where the character
 * should be. It reports what the client knows (window position, posture, VRM) and
 * forwards the verb it was handed — perch gestures go to the perch source's
 * programmatic placement, which shares the drag flow's geometry and arming.
 *
 * One command runs at a time (a second is `busy`). A user drag wins outright: it
 * aborts the running command and refuses new ones as `interrupted` until the drag
 * ends, since the user is holding the avatar. Queries are never gated.
 *
 * All OS seams (Tauri window, monitors, placement) are injected so the module is
 * unit-testable without the Tauri runtime.
 */

import type { Posture } from "../contract";
import { createLogger } from "../logger";
import type {
  AvatarCommand,
  AvatarCommandResult,
  AvatarFailure,
  AvatarPerchTargets,
  AvatarPosition,
  AvatarRpcRequest,
  AvatarSpot,
  AvatarState,
} from "./avatar-rpc";
import type {
  PerchTargets,
  PlacementOptions,
  PlacementRequest,
  PlacementResult,
} from "./window-drop-source";

const log = createLogger("avatar-executor");

/** Inset from a monitor corner for the corner spots (physical px). */
const EDGE_MARGIN_PX = 24;

/** Pet window accessors the executor reads and writes, all in physical px. */
export interface AvatarExecutorWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  setPositionPhysical(x: number, y: number): Promise<void>;
}

/** One monitor's physical bounds. */
export interface AvatarMonitor {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface AvatarExecutorDeps {
  /** Subscribe to bridged requests (the `avatar-rpc` channel). */
  subscribe(cb: (req: AvatarRpcRequest) => void): () => void;
  /** Answer one request by id. */
  respond(id: string, result: unknown): void;
  /** The perch candidate model + the placement/release flow. */
  perch: {
    placeOn(request: PlacementRequest, opts?: PlacementOptions): Promise<PlacementResult>;
    perchTargets(): Promise<PerchTargets>;
    release(): void;
  };
  getWindow(): AvatarExecutorWindow;
  listMonitors(): Promise<AvatarMonitor[]>;
  getPosture(): Posture;
  getVrm(): { id: string; label: string } | null;
  /** Record that the avatar just relocated on its own — a successful move_to restamps posture. */
  noteAvatarMoved(): void;
}

export interface AvatarExecutor {
  /** Subscribe to the request channel. Idempotent. */
  start(): void;
  /** Unsubscribe. */
  stop(): void;
  /**
   * A user drag beats the agent: abort the running command and refuse further ones
   * until {@link AvatarExecutor.noteUserDragEnd} — the user owns the avatar meanwhile.
   */
  noteUserDrag(): void;
  /** The user let go; agent commands are accepted again. */
  noteUserDragEnd(): void;
}

function fail(reason: AvatarFailure): AvatarCommandResult {
  return { ok: false, reason };
}

/** Narrow a bridged `command` payload. Rust already validates it; this is the belt. */
function parseCommand(params: unknown): AvatarCommand | null {
  if (params === null || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  switch (p.action) {
    case "sit_on_window": {
      // An empty app name would match every window, so it is malformed, not a miss.
      const app = typeof p.app === "string" ? p.app.trim() : "";
      return app.length > 0 ? { action: "sit_on_window", app } : null;
    }
    case "peek":
      return p.side === "left" || p.side === "right" ? { action: "peek", side: p.side } : null;
    case "move_to": {
      const spots: AvatarSpot[] = [
        "center",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ];
      if (!spots.includes(p.spot as AvatarSpot)) return null;
      const monitor = typeof p.monitor === "number" ? p.monitor : undefined;
      return {
        action: "move_to",
        spot: p.spot as AvatarSpot,
        ...(monitor === undefined ? {} : { monitor }),
      };
    }
    case "stand_down":
      return { action: "stand_down" };
    default:
      return null;
  }
}

/** Index of the monitor whose bounds contain the point, or null. */
function monitorAt(monitors: AvatarMonitor[], x: number, y: number): number | null {
  const index = monitors.findIndex(
    (m) =>
      x >= m.position.x &&
      x < m.position.x + m.size.width &&
      y >= m.position.y &&
      y < m.position.y + m.size.height,
  );
  return index < 0 ? null : index;
}

/** Physical origin that puts a `size` window at `spot` of `monitor`. */
function spotOrigin(
  monitor: AvatarMonitor,
  size: { width: number; height: number },
  spot: AvatarSpot,
): { x: number; y: number } {
  const { x: mx, y: my } = monitor.position;
  const { width: mw, height: mh } = monitor.size;
  const left = mx + EDGE_MARGIN_PX;
  const right = mx + mw - size.width - EDGE_MARGIN_PX;
  const top = my + EDGE_MARGIN_PX;
  const bottom = my + mh - size.height - EDGE_MARGIN_PX;
  switch (spot) {
    case "top-left":
      return { x: left, y: top };
    case "top-right":
      return { x: right, y: top };
    case "bottom-left":
      return { x: left, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    default:
      return { x: mx + (mw - size.width) / 2, y: my + (mh - size.height) / 2 };
  }
}

export function createAvatarExecutor(deps: AvatarExecutorDeps): AvatarExecutor {
  const { perch, getWindow, listMonitors, getPosture, getVrm, noteAvatarMoved } = deps;

  let unsubscribe: (() => void) | undefined;
  let moving = false;
  let interrupted = false;
  let dragging = false;

  /** Whether the running command should give up: the user has taken over. */
  function aborted(): boolean {
    return interrupted || dragging;
  }

  /** Hand a perch gesture to the placement flow and translate its verdict. */
  async function place(request: PlacementRequest): Promise<AvatarCommandResult> {
    const result = await perch.placeOn(request, { shouldAbort: aborted });
    if (aborted()) return fail("interrupted");
    return result.ok ? { ok: true } : fail(result.reason);
  }

  async function moveTo(spot: AvatarSpot, monitor?: number): Promise<AvatarCommandResult> {
    const monitors = await listMonitors();
    if (monitors.length === 0) return fail("unsupported");
    const win = getWindow();
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    let index: number;
    if (monitor === undefined) {
      index = monitorAt(monitors, pos.x, pos.y) ?? 0;
    } else {
      if (monitor < 0 || monitor >= monitors.length) return fail("not_found");
      index = monitor;
    }
    if (aborted()) return fail("interrupted");
    // A perch pins the character to a window edge — leave it before relocating.
    perch.release();
    const origin = spotOrigin(monitors[index], size, spot);
    await win.setPositionPhysical(origin.x, origin.y);
    if (aborted()) return fail("interrupted");
    noteAvatarMoved();
    return { ok: true };
  }

  async function runCommand(command: AvatarCommand): Promise<AvatarCommandResult> {
    switch (command.action) {
      case "sit_on_window":
        return place({ kind: "sit", app: command.app });
      case "peek":
        return place({ kind: "peek", side: command.side });
      case "move_to":
        return moveTo(command.spot, command.monitor);
      case "stand_down":
        perch.release();
        return { ok: true };
    }
  }

  async function handleCommand(params: unknown): Promise<AvatarCommandResult> {
    const command = parseCommand(params);
    if (!command) return fail("unsupported");
    // The user is holding the avatar — the agent does not get to move it out from
    // under them, so refuse rather than queue.
    if (dragging) return fail("interrupted");
    if (moving) return fail("busy");
    moving = true;
    interrupted = false;
    try {
      return await runCommand(command);
    } catch (err) {
      log.warn("command_failed", { action: command.action, error: String(err) });
      return fail("unsupported");
    } finally {
      moving = false;
    }
  }

  async function readPosition(): Promise<AvatarPosition | null> {
    try {
      const pos = await getWindow().outerPosition();
      const monitors = await listMonitors().catch(() => []);
      return { x: pos.x, y: pos.y, monitor: monitorAt(monitors, pos.x, pos.y) };
    } catch (err) {
      log.debug("position_unavailable", { degrade: true, error: String(err) });
      return null;
    }
  }

  async function readState(): Promise<AvatarState> {
    return {
      position: await readPosition(),
      posture: getPosture(),
      vrm: getVrm(),
      moving,
    };
  }

  async function readPerchTargets(): Promise<AvatarPerchTargets> {
    try {
      return await perch.perchTargets();
    } catch (err) {
      log.debug("perch_targets_unavailable", { degrade: true, error: String(err) });
      return { windows: [], edges: ["left", "right"] };
    }
  }

  async function handle(req: AvatarRpcRequest): Promise<unknown> {
    switch (req.method) {
      case "state":
        return readState();
      case "perch_targets":
        return readPerchTargets();
      case "command":
        return handleCommand(req.params);
      default:
        log.warn("unknown_method", { method: req.method });
        return fail("unsupported");
    }
  }

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = deps.subscribe((req) => {
        void handle(req)
          .then((result) => deps.respond(req.id, result))
          .catch((err) => {
            log.warn("request_failed", { method: req.method, error: String(err) });
            deps.respond(req.id, fail("unsupported"));
          });
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    noteUserDrag() {
      dragging = true;
      if (moving) interrupted = true;
    },
    noteUserDragEnd() {
      dragging = false;
    },
  };
}
