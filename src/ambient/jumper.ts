/**
 * Jumping across to an adjacent foreign window's top.
 *
 * A perched stroll that finds a reachable neighbour walks to the host's edge on that
 * side and jumps: the VRM plays the in-place jump clip at scene origin while the OS
 * window travels a parabola from one window top to the other. Only the clip's airborne
 * stretch moves the window — the crouch and the recovery play where they are.
 *
 * Eligibility and the arc are pure functions; createJumper owns the clip, the per-frame
 * travel, and the two reads of the target window that bracket the flight.
 */

import type { JumpConfig, PerchWalkConfig } from "../config/load";
import type { WindowRect } from "../contract";
import { MOVE_TH, uncoveredSpan } from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { TickFn } from "../renderer";
import { WALK_YAW_EASE_MS, WALK_YAW_RAD } from "./walker";

const log = createLogger("jumper");

/** Registry id of the clip the whole jump is paced by. */
export const JUMP_MOTION_ID = "jump";

/** Where a jump goes: the window it lands on, and the two points it runs between. */
export interface JumpPlan {
  target: WindowRect;
  side: "left" | "right";
  /** Global x (logical px) the feet leave the host from. */
  takeoffX: number;
  /** Global x the feet come down on. */
  landingX: number;
}

/**
 * The neighbouring window top she can reach from the host, or null when none can be.
 * Both ends are held to the stroll's own reachability: each has to sit a margin inside the
 * uncovered stretch of the window it belongs to, which is what rules out a takeoff she
 * cannot walk to and a landing a nearer window straddles.
 * Nearest gap wins; a tie goes to the smaller height difference.
 */
export function pickJumpTarget(args: {
  /** Front-to-back, topmost first. */
  windows: WindowRect[];
  hostIndex: number;
  /** Where the feet are on the host now — the walkable stretch is measured from it. */
  currentX: number;
  charHpx: number;
  charWpx: number;
  perchCfg: PerchWalkConfig;
  jumpCfg: JumpConfig;
  /** Highest window top she can stand on: the work-area top plus the feet offset. */
  minStandingTop: number;
  /** Height difference within which a touching neighbour is walked across instead. */
  levelTolerancePx: number;
}): JumpPlan | null {
  const {
    windows,
    hostIndex,
    currentX,
    charHpx,
    charWpx,
    perchCfg,
    jumpCfg,
    minStandingTop,
    levelTolerancePx,
  } = args;
  const host = windows[hostIndex];
  if (!host) return null;
  const margin = perchCfg.edge_margin_frac * charHpx;
  const hostSpan = uncoveredSpan(windows, hostIndex, currentX);
  let best: { plan: JumpPlan; gap: number; rise: number } | null = null;

  for (const [index, candidate] of windows.entries()) {
    if (index === hostIndex) continue;
    // The OS clamps the pet window to the work area, so a top above that line would
    // leave her feet hanging below the edge she landed on.
    if (candidate.y < minStandingTop) continue;
    const rise = Math.abs(candidate.y - host.y);
    const limit = candidate.y < host.y ? jumpCfg.height_up_max_frac : jumpCfg.height_down_max_frac;
    if (rise > limit * charHpx) continue;
    // The larger of the two facing-edge distances names the side she leaves on: positive
    // means the candidate is clear of the host, negative that the two windows overlap.
    const toRight = candidate.x - (host.x + host.width);
    const toLeft = host.x - (candidate.x + candidate.width);
    const side = toRight >= toLeft ? "right" : "left";
    const gap = Math.max(0, side === "right" ? toRight : toLeft);
    // A neighbour level with the host and touching it is one ledge with it: she walks
    // across the seam on the stroll, so the jump leaves it to the next-best candidate.
    if (rise <= levelTolerancePx && gap === 0) continue;
    if (gap > jumpCfg.gap_max_width_frac * charWpx) continue;
    if (best && (gap > best.gap || (gap === best.gap && rise >= best.rise))) continue;

    // She leaves from the far end of the stretch she can actually walk: the host's own
    // edge across a clear gap, and a covering window's near edge under one.
    const takeoffX = side === "right" ? hostSpan.right - margin : hostSpan.left + margin;
    if (!reachable(takeoffX, hostSpan, margin)) continue;
    // She comes down on the near end of the candidate's stretch, sampled just inside it
    // on the side she arrives from — measured anywhere else the span would answer for a
    // different part of that window's top.
    const probeX = Math.min(
      Math.max(takeoffX + toward(side) * (gap + margin), candidate.x + margin),
      candidate.x + candidate.width - margin,
    );
    const landingSpan = uncoveredSpan(windows, index, probeX);
    const landingX = side === "right" ? landingSpan.left + margin : landingSpan.right - margin;
    if (!reachable(landingX, landingSpan, margin)) continue;

    best = { plan: { target: candidate, side, takeoffX, landingX }, gap, rise };
  }
  return best?.plan ?? null;
}

/** Sign of travel for a jump to either side: right is the direction of growing x. */
function toward(side: "left" | "right"): 1 | -1 {
  return side === "right" ? 1 : -1;
}

/** Whether `x` sits a margin inside an uncovered stretch. An inverted span reaches nothing. */
function reachable(x: number, span: { left: number; right: number }, margin: number): boolean {
  return x >= span.left + margin && x <= span.right - margin;
}

/**
 * Screen y of the flight at `u` in [0, 1], between the two window tops. The apex sits
 * `lift` above the higher of them, so a jump up and a jump down clear the same headroom.
 */
export function jumpArc(u: number, from: number, to: number, lift: number): number {
  const apex = lift + Math.abs(to - from) / 2;
  return (1 - u) * from + u * to - 4 * apex * u * (1 - u);
}

interface JumperWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  setPositionPhysical(x: number, y: number): Promise<void>;
}

export interface JumperDeps {
  renderer: {
    onTick(fn: TickFn): () => void;
    preloadMotion(id: string): Promise<void>;
    playMotion(motion: { id: string } | null): void;
    setBodyYaw(rad: number, easeMs: number): void;
    getCurrentMotion(): { id: string } | null;
    getCurrentMotionTime(): number | null;
    getMotionDuration(id: string): number | null;
  };
  getWindow(): JumperWindow;
  /** Foreign windows, front-to-back — the target is read from it at both ends of the flight. */
  listWindows(): Promise<WindowRect[]>;
  getConfig(): JumpConfig;
}

/**
 * How the flight ended. `refused` is the one outcome that never left the ground, so the
 * caller still owns the seat it was standing on; the others all leave her off it.
 */
export type JumpOutcome = "landed" | "lost" | "cancelled" | "refused";

export interface Jumper {
  /**
   * Cross to `plan.target`, the character already standing on the host's edge at
   * `plan.takeoffX`. `anchor` is the feet offset inside the pet window (logical px).
   * `onTakeoff` fires on the frame her feet actually leave the host — the point of no
   * return, after which the caller's old seat is gone. A clip taken away before that
   * comes back `refused`, with her still standing where she started.
   */
  jump(
    plan: JumpPlan,
    at: { anchor: { x: number; y: number }; charHpx: number; scale: number },
    onTakeoff?: () => void,
  ): Promise<JumpOutcome>;
  /** End a running flight where it hangs, silently. */
  cancel(): void;
}

interface Flight {
  win: JumperWindow;
  plan: JumpPlan;
  cfg: JumpConfig;
  /** Window origin (physical px) at both ends of the arc. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Apex height above the higher of the two tops, physical px. */
  lift: number;
  /** Wall-clock the flight has run, against the deadline the clip could stall past. */
  elapsedS: number;
  /** The window has moved at least once, so she is off the host and owes a landing. */
  airborne: boolean;
  /** The landing read is out — later frames leave the window alone until it comes back. */
  landing: boolean;
  onTakeoff?: () => void;
  settle: (outcome: JumpOutcome) => void;
}

export function createJumper(deps: JumperDeps): Jumper {
  const { renderer } = deps;
  /** Bumped by every cancel so an in-flight jump drops its plan. */
  let generation = 0;
  let flight: Flight | null = null;
  let unsub: (() => void) | null = null;

  function finish(outcome: JumpOutcome): void {
    const f = flight;
    if (!f) return;
    flight = null;
    unsub?.();
    unsub = null;
    f.settle(outcome);
  }

  /**
   * Whether the window she is aiming at has gone or slid since the plan was made. Read
   * once before she commits and once as she comes down: the flight is far too short for
   * a poll, and those are the only two moments the answer changes anything.
   */
  async function targetMoved(target: WindowRect): Promise<boolean> {
    const windows = await deps.listWindows();
    const now = windows.find((w) => w.windowNumber === target.windowNumber);
    return !now || Math.abs(now.x - target.x) > MOVE_TH || Math.abs(now.y - target.y) > MOVE_TH;
  }

  function move(f: Flight, x: number, y: number): void {
    void f.win
      .setPositionPhysical(Math.round(x), Math.round(y))
      .catch((error) => log.warn("move_failed", { degrade: true, error: String(error) }));
  }

  function land(f: Flight): void {
    f.landing = true;
    const startedAt = generation;
    void targetMoved(f.plan.target)
      .then((moved) => {
        if (generation !== startedAt || flight !== f) return;
        if (moved) {
          log.info("target_lost", { windowNumber: f.plan.target.windowNumber });
          finish("lost");
          return;
        }
        move(f, f.to.x, f.to.y);
        finish("landed");
      })
      .catch((error) => {
        log.warn("landing_read_failed", { degrade: true, error: String(error) });
        if (flight === f) finish("lost");
      });
  }

  function tick(ctx: { dt: number }): void {
    const f = flight;
    if (!f) return;
    // Counted above every other guard: a clip that never becomes measurable and a landing
    // read that never comes back would each hang the flight for good, and the whole perch
    // loop waits on it.
    f.elapsedS += ctx.dt;
    if (f.elapsedS * 1000 > f.cfg.flight_timeout_ms) {
      log.warn("flight_timed_out", { degrade: true, airborne: f.airborne });
      finish(f.airborne ? "lost" : "refused");
      return;
    }
    if (f.landing) return;
    // Anything else taking the clip takes the playhead with it, and a window driven off
    // another clip's time would go anywhere. Before the first move she is still standing
    // on the host, so the jump is simply off; after it she is in the air and owes a fall.
    if (renderer.getCurrentMotion()?.id !== JUMP_MOTION_ID) {
      finish(f.airborne ? "lost" : "refused");
      return;
    }
    const duration = renderer.getMotionDuration(JUMP_MOTION_ID);
    const at = renderer.getCurrentMotionTime();
    if (duration === null || !(duration > 0) || at === null) return;
    const played = at / duration;
    // Outside the clip's airborne stretch the window holds still: the crouch and the
    // recovery are danced on the spot.
    if (played < f.cfg.takeoff_frac) return;
    const u = Math.min((played - f.cfg.takeoff_frac) / (f.cfg.land_frac - f.cfg.takeoff_frac), 1);
    if (!f.airborne) {
      // Her feet leave the host on this frame, and the seat behind her goes with them.
      f.airborne = true;
      f.onTakeoff?.();
    }
    if (u >= 1) {
      land(f);
      return;
    }
    move(f, f.from.x + (f.to.x - f.from.x) * u, jumpArc(u, f.from.y, f.to.y, f.lift));
  }

  return {
    async jump(plan, at, onTakeoff) {
      const startedAt = generation;
      // The clip has to be cached before it plays, or its length is unreadable for the
      // first frames of the flight and the window would sit out its own arc.
      await renderer.preloadMotion(JUMP_MOTION_ID);
      if (generation !== startedAt) return "cancelled";
      if (await targetMoved(plan.target)) {
        log.debug("jump_skipped", { reason: "target_moved" });
        return "refused";
      }
      if (generation !== startedAt) return "cancelled";
      const win = deps.getWindow();
      const from = await win.outerPosition();
      if (generation !== startedAt) return "cancelled";
      renderer.playMotion({ id: JUMP_MOTION_ID });
      if (renderer.getCurrentMotion()?.id !== JUMP_MOTION_ID) {
        log.debug("jump_skipped", { reason: "clip_refused" });
        return "refused";
      }
      // She crosses side-on, the way the stroll walks, instead of face-on to the camera.
      renderer.setBodyYaw(toward(plan.side) * WALK_YAW_RAD, WALK_YAW_EASE_MS);
      const cfg = deps.getConfig();
      return new Promise((settle) => {
        flight = {
          win,
          plan,
          cfg,
          from,
          to: {
            x: (plan.landingX - at.anchor.x) * at.scale,
            y: (plan.target.y - at.anchor.y) * at.scale,
          },
          lift: cfg.apex_lift_frac * at.charHpx * at.scale,
          elapsedS: 0,
          airborne: false,
          landing: false,
          onTakeoff,
          settle,
        };
        unsub = renderer.onTick(tick);
      });
    },
    cancel() {
      generation++;
      // Whatever interrupted her plays its own clip but never unwinds the turn the jump
      // put her in; the walker's reset is no help with no walk of its own live.
      if (flight) renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
      finish("cancelled");
    },
  };
}
