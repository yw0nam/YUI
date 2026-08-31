/**
 * Jumping across to an adjacent foreign window's top.
 *
 * A perched stroll that finds a reachable neighbour walks to the host's edge on that
 * side and jumps: the VRM plays the in-place jump clip at scene origin while the OS
 * window travels a parabola from one window top to the other. Only the clip's airborne
 * stretch moves the window — the crouch and the recovery play where they are.
 *
 * Eligibility and the arc are pure functions; createJumper owns the clip, the per-frame
 * travel and the watch that catches the target window leaving mid-flight.
 */

import type { JumpConfig } from "../config/load";
import type { WindowRect } from "../contract";
import { containsSeat, MOVE_TH, PERCH_POLL_MS } from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { TickFn } from "../renderer";

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
 * `span` is the host stretch she can actually walk to (the stroll's own uncovered span),
 * and `margin` the stroll's edge margin — the takeoff and the landing both stay inside it.
 * Nearest gap wins; a tie goes to the smaller height difference.
 */
export function pickJumpTarget(args: {
  /** Front-to-back, topmost first. */
  windows: WindowRect[];
  hostIndex: number;
  span: { left: number; right: number };
  charHpx: number;
  charWpx: number;
  margin: number;
  cfg: JumpConfig;
}): JumpPlan | null {
  const { windows, hostIndex, span, charHpx, charWpx, margin, cfg } = args;
  const host = windows[hostIndex];
  if (!host) return null;
  let best: { plan: JumpPlan; gap: number; rise: number } | null = null;

  for (const [index, candidate] of windows.entries()) {
    if (index === hostIndex) continue;
    const rise = Math.abs(candidate.y - host.y);
    const limit = candidate.y < host.y ? cfg.height_up_max_frac : cfg.height_down_max_frac;
    if (rise > limit * charHpx) continue;
    // The larger of the two facing-edge distances names the side she leaves on: positive
    // means the candidate is clear of the host, negative that the two windows overlap.
    const toRight = candidate.x - (host.x + host.width);
    const toLeft = host.x - (candidate.x + candidate.width);
    const side = toRight >= toLeft ? "right" : "left";
    const gap = Math.max(0, side === "right" ? toRight : toLeft);
    if (gap > cfg.gap_max_width_frac * charWpx) continue;
    if (best && (gap > best.gap || (gap === best.gap && rise >= best.rise))) continue;

    const takeoffX = side === "right" ? host.x + host.width - margin : host.x + margin;
    if (takeoffX < span.left || takeoffX > span.right) continue;
    // Across a gap she lands just inside the near edge; over an overlap the near edge is
    // behind her, so she carries one body width past the host's own.
    const nearEdge = side === "right" ? candidate.x : candidate.x + candidate.width;
    const inward = side === "right" ? 1 : -1;
    const landingX: number = gap > 0 ? nearEdge + inward * margin : takeoffX + inward * charWpx;
    if (landingX < candidate.x + margin || landingX > candidate.x + candidate.width - margin) {
      continue;
    }
    const seat = { x: landingX, y: candidate.y };
    if (windows.some((front, i) => i < index && containsSeat(front, seat))) continue;

    best = { plan: { target: candidate, side, takeoffX, landingX }, gap, rise };
  }
  return best?.plan ?? null;
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
    playMotion(motion: { id: string } | null): void;
    getCurrentMotion(): { id: string } | null;
    getMotionDuration(id: string): number | null;
  };
  getWindow(): JumperWindow;
  /** Foreign windows, front-to-back — the target is re-read from it in flight. */
  listWindows(): Promise<WindowRect[]>;
  getConfig(): JumpConfig;
  /** The clip took the body: the jump is committed and its cue goes out. */
  onTakeoff(): void;
}

/** How the flight ended: on the target, in mid-air, or taken over by something else. */
export type JumpOutcome = "landed" | "lost" | "cancelled";

export interface Jumper {
  /**
   * Cross to `plan.target`, the character already standing on the host's edge at
   * `plan.takeoffX`. `anchor` is the feet offset inside the pet window (logical px).
   */
  jump(
    plan: JumpPlan,
    at: { anchor: { x: number; y: number }; charHpx: number; scale: number },
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
  elapsedS: number;
  sinceWatchS: number;
  watching: boolean;
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

  /** Re-read the stack: the window she is aiming at has to still be where she left it. */
  function watchTarget(f: Flight, dt: number): void {
    f.sinceWatchS += dt;
    if (f.watching || f.sinceWatchS * 1000 < PERCH_POLL_MS) return;
    f.sinceWatchS = 0;
    f.watching = true;
    const startedAt = generation;
    void deps
      .listWindows()
      .then((windows) => {
        if (generation !== startedAt || flight !== f) return;
        const target = windows.find((w) => w.windowNumber === f.plan.target.windowNumber);
        const lost =
          !target ||
          Math.abs(target.x - f.plan.target.x) > MOVE_TH ||
          Math.abs(target.y - f.plan.target.y) > MOVE_TH;
        if (!lost) return;
        log.info("target_lost", { windowNumber: f.plan.target.windowNumber });
        finish("lost");
      })
      .catch((error) => log.warn("target_watch_failed", { degrade: true, error: String(error) }))
      .finally(() => {
        f.watching = false;
      });
  }

  function tick(ctx: { dt: number }): void {
    const f = flight;
    if (!f) return;
    f.elapsedS += ctx.dt;
    watchTarget(f, ctx.dt);
    const duration = renderer.getMotionDuration(JUMP_MOTION_ID);
    if (duration === null || !(duration > 0)) return;
    const played = f.elapsedS / duration;
    // Outside the clip's airborne stretch the window holds still: the crouch and the
    // recovery are danced on the spot.
    if (played < f.cfg.takeoff_frac) return;
    const u = Math.min((played - f.cfg.takeoff_frac) / (f.cfg.land_frac - f.cfg.takeoff_frac), 1);
    const x = f.from.x + (f.to.x - f.from.x) * u;
    const y = u >= 1 ? f.to.y : jumpArc(u, f.from.y, f.to.y, f.lift);
    void f.win
      .setPositionPhysical(Math.round(x), Math.round(y))
      .catch((error) => log.warn("move_failed", { degrade: true, error: String(error) }));
    if (u >= 1) finish("landed");
  }

  return {
    async jump(plan, at) {
      const startedAt = generation;
      renderer.playMotion({ id: JUMP_MOTION_ID });
      if (renderer.getCurrentMotion()?.id !== JUMP_MOTION_ID) return "lost";
      deps.onTakeoff();
      const win = deps.getWindow();
      const from = await win.outerPosition();
      if (generation !== startedAt) return "cancelled";
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
          sinceWatchS: 0,
          watching: false,
          settle,
        };
        unsub = renderer.onTick(tick);
      });
    },
    cancel() {
      generation++;
      finish("cancelled");
    },
  };
}
