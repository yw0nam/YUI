/**
 * avatar-executor — answers the bridged avatar RPCs from live client state.
 *
 * Execution only, no judgment: the executor never decides where the character
 * should be. It reports what the client knows (window position, posture, VRM) and
 * carries out the verb it was handed, reusing the perch flow that a real drag
 * release goes through. Because the backend already knows it asked for the gesture,
 * an executor-driven perch suppresses its proactive cue — posture updates as usual,
 * so the next turn's env still reflects reality.
 *
 * One command runs at a time (a second is `busy`); a user drag wins and aborts the
 * running one as `interrupted`. Queries are never gated.
 *
 * All OS seams (Tauri window, monitors, perch settle) are injected so the module is
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
import type { PerchTargets, SettleOutcome } from "./window-drop-source";

const log = createLogger("avatar-executor");

/** Inset from a monitor corner for the corner spots (physical px). */
const EDGE_MARGIN_PX = 24;

/** Pet window accessors the executor reads and writes, all in physical px. */
export interface AvatarExecutorWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
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
  /** The perch candidate model + the settle/release flow. */
  perch: {
    settle(opts?: { suppressCue?: boolean }): Promise<SettleOutcome>;
    perchTargets(): Promise<PerchTargets>;
    release(): void;
  };
  renderer: {
    getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  };
  getWindow(): AvatarExecutorWindow;
  listMonitors(): Promise<AvatarMonitor[]>;
  getPosture(): Posture | undefined;
  getVrm(): { id: string; label: string } | null;
}

export interface AvatarExecutor {
  /** Subscribe to the request channel. Idempotent. */
  start(): void;
  /** Unsubscribe. */
  stop(): void;
  /** A user drag beats the agent: abort the running command as interrupted. */
  noteUserDrag(): void;
}

function fail(reason: AvatarFailure): AvatarCommandResult {
  return { ok: false, reason };
}

/** Narrow a bridged `command` payload. Rust already validates it; this is the belt. */
function parseCommand(params: unknown): AvatarCommand | null {
  if (params === null || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  switch (p.action) {
    case "sit_on_window":
      return typeof p.app === "string" ? { action: "sit_on_window", app: p.app } : null;
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
  const { perch, renderer, getWindow, listMonitors, getPosture, getVrm } = deps;

  let unsubscribe: (() => void) | undefined;
  let moving = false;
  let interrupted = false;

  /** Move the pet window so the character's seat lands on `seatGlobal` (points). */
  async function moveSeatTo(seatGlobal: { x: number; y: number }): Promise<boolean> {
    const probe = renderer.getPerchProbe();
    if (!probe) return false;
    const win = getWindow();
    const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    const sf = scale > 0 ? scale : 1;
    const currentSeat = { x: pos.x / sf + probe.seatPx.x, y: pos.y / sf + probe.seatPx.y };
    await win.setPositionPhysical(
      pos.x + (seatGlobal.x - currentSeat.x) * sf,
      pos.y + (seatGlobal.y - currentSeat.y) * sf,
    );
    return true;
  }

  async function sitOnWindow(app: string): Promise<AvatarCommandResult> {
    const targets = await perch.perchTargets();
    const needle = app.toLowerCase();
    const target =
      targets.windows.find((w) => w.app?.toLowerCase() === needle) ??
      targets.windows.find(
        (w) => w.app?.toLowerCase().includes(needle) || w.title?.toLowerCase().includes(needle),
      );
    if (!target) return fail("not_found");
    if (interrupted) return fail("interrupted");
    // Seat lands on the horizontal center of the window's top edge — inside the
    // catch zone the settle pass hit-tests against.
    const moved = await moveSeatTo({
      x: target.rect.x + target.rect.width / 2,
      y: target.rect.y,
    });
    if (!moved) return fail("unsupported");
    if (interrupted) return fail("interrupted");
    const outcome = await perch.settle({ suppressCue: true });
    if (interrupted) return fail("interrupted");
    return outcome.kind === "sit" ? { ok: true } : fail("not_found");
  }

  async function peek(side: "left" | "right"): Promise<AvatarCommandResult> {
    const targets = await perch.perchTargets();
    const target = targets.windows[0];
    if (!target) return fail("not_found");
    if (interrupted) return fail("interrupted");
    const moved = await moveSeatTo({
      x: side === "left" ? target.rect.x : target.rect.x + target.rect.width,
      y: target.rect.y + target.rect.height / 2,
    });
    if (!moved) return fail("unsupported");
    if (interrupted) return fail("interrupted");
    const outcome = await perch.settle({ suppressCue: true });
    if (interrupted) return fail("interrupted");
    return outcome.kind === "peek" && outcome.side === side ? { ok: true } : fail("not_found");
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
    if (interrupted) return fail("interrupted");
    // A perch pins the character to a window edge — leave it before relocating.
    perch.release();
    const origin = spotOrigin(monitors[index], size, spot);
    await win.setPositionPhysical(origin.x, origin.y);
    return interrupted ? fail("interrupted") : { ok: true };
  }

  async function runCommand(command: AvatarCommand): Promise<AvatarCommandResult> {
    switch (command.action) {
      case "sit_on_window":
        return sitOnWindow(command.app);
      case "peek":
        return peek(command.side);
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
      posture: getPosture() ?? null,
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
      if (moving) interrupted = true;
    },
  };
}
