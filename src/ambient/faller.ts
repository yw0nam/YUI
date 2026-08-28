/**
 * Falling — a drag-release that lands mid-air drops the character to the floor.
 *
 * Presentation only, no judgment: the client fires the fall, the backend decides
 * whether to say anything about it. The VRM stays at scene origin playing the
 * `falling` clip while a per-frame loop accelerates the OS window down to the floor
 * line, then `landing` plays and the registry returns her to idle.
 *
 * Anything else outranks the fall: a pickup, a pat, a backend turn's express motion all
 * keep the body, and the window keeps descending under them. The clip is best-effort and
 * only ever reclaimed from the ambient baseline, which is the one clip the descent loses
 * to itself — the drag-release envelopes return the body to it a pump into the descent.
 * Picking her up is what ends a fall, through cancel() on the drag start.
 *
 * Pure geometry/integration lives in the exported functions; createFaller owns the
 * frame hook, the async window reads and the window translation.
 */

import type { FallConfig } from "../config/load";
import type { MotionKind } from "../contract";
import { floorPx, monitorAt, type PetWindow, type ScreenMonitor } from "../io/screen-geometry";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { prefersReducedMotion } from "./tier1";
import { MAX_STEP_DT_S } from "./walker";

const log = createLogger("faller");

/** Registry id of the looping descent clip. */
export const FALL_MOTION_ID = "falling";
/** Registry id of the touchdown clip. */
export const LAND_MOTION_ID = "landing";

/** What a drag release resolves to: nothing to do, a silent snap, or a fall. */
export type FallPlan =
  | { kind: "none" }
  | { kind: "snap"; toY: number }
  | { kind: "fall"; toY: number; heightPx: number };

/**
 * One drop: how far the feet are above the floor decides between nothing, a snap and a
 * fall. All arguments and results are logical px; `toY` is the window y that grounds
 * the feet.
 */
export function planFall(args: {
  /** Window origin y. */
  windowY: number;
  /** Global y of the feet anchor. */
  feetY: number;
  floorY: number;
  /** On-screen character height — the min-drop threshold scales with the framing. */
  charHpx: number;
  cfg: FallConfig;
  tolerancePx: number;
}): FallPlan {
  const { windowY, feetY, floorY, charHpx, cfg, tolerancePx } = args;
  const drop = floorY - feetY;
  if (drop <= tolerancePx) return { kind: "none" };
  const toY = windowY + drop;
  if (drop < charHpx * cfg.min_drop_frac) return { kind: "snap", toY };
  return { kind: "fall", toY, heightPx: drop };
}

/** A descent in flight: where it is, how fast, and where it stops. */
export interface FallState {
  y: number;
  v: number;
  toY: number;
}

/** One dt of gravity, capped at the terminal velocity and clamped at the floor. */
export function stepFall(
  state: FallState,
  dt: number,
  cfg: FallConfig,
): { y: number; v: number; landed: boolean } {
  const v = Math.min(state.v + cfg.gravity_px_s2 * dt, cfg.max_speed_px_s);
  const y = state.y + v * dt;
  return y >= state.toY ? { y: state.toY, v, landed: true } : { y, v, landed: false };
}

export interface FallerDeps {
  renderer: Pick<
    Renderer,
    "onTick" | "playMotion" | "getCurrentMotion" | "getCharacterAnchor" | "getPerchProbe"
  >;
  getWindow(): PetWindow;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
  listMonitors(): Promise<ScreenMonitor[]>;
  getConfig(): FallConfig;
  /** How far the feet may sit from the floor and still count as grounded (logical px). */
  getFloorTolerancePx(): number;
  /** Defaults to the OS setting; injected in tests. */
  reducedMotion?: () => boolean;
  /** Injectable clock for the cue cooldown; defaults to Date.now. */
  now?: () => number;
  /** The descent began — the hit test follows the moving window. */
  onStart(): void;
  /** Touchdown, carrying the height fallen in logical px. */
  onLand(heightPx: number): void;
  /** Touchdown outside the cue cooldown — the speech candidate the backend judges. */
  onCue(heightPx: number): void;
  /** The descent landed, was cancelled, or lost the clip. */
  onEnd(): void;
}

export interface Faller {
  /** Drop from where the character hangs. Ignored while a fall is already running. */
  drop(): Promise<void>;
  /** End a running fall now. */
  cancel(): void;
  stop(): void;
}

export function createFaller(deps: FallerDeps): Faller {
  const { renderer } = deps;
  const now = deps.now ?? Date.now;
  const reducedMotion = deps.reducedMotion ?? prefersReducedMotion;

  let unsub: (() => void) | null = null;
  /** Live descent, all in physical px. */
  let fall: {
    x: number;
    y: number;
    v: number;
    toY: number;
    /** Config scaled to physical px, so the descent reads the same at any scale factor. */
    cfg: FallConfig;
    heightPx: number;
    win: PetWindow;
  } | null = null;
  /** True while the async drop-time reads are in flight. */
  let starting = false;
  /** Bumped by every cancel/stop so an in-flight begin() drops its plan. */
  let generation = 0;
  let stopped = false;
  let lastCueAtMs = Number.NEGATIVE_INFINITY;

  /** Report the touchdown: the signal always, the speech candidate on its own cooldown. */
  function reportLanding(heightPx: number): void {
    deps.onLand(heightPx);
    const t = now();
    if (t - lastCueAtMs < deps.getConfig().cue_cooldown_ms) return;
    lastCueAtMs = t;
    deps.onCue(heightPx);
  }

  /** Drop the descent and its frame hook; false when none was running. */
  function clear(): boolean {
    generation += 1;
    if (!fall) return false;
    fall = null;
    unsub?.();
    unsub = null;
    return true;
  }

  /** End the descent short of the floor. Leaves the clip alone when something else took it. */
  function endFall(): void {
    if (!clear()) return;
    if (renderer.getCurrentMotion()?.id === FALL_MOTION_ID) renderer.playMotion(null);
    deps.onEnd();
  }

  /** One frame of descent. Only the ambient baseline hands the clip back. */
  function step(dt: number): void {
    const s = fall;
    if (!s) return;
    if (
      renderer.getCurrentMotion()?.id !== FALL_MOTION_ID &&
      deps.currentMotionKind() === "ambient"
    ) {
      renderer.playMotion({ id: FALL_MOTION_ID });
    }
    const next = stepFall(s, Math.min(dt, MAX_STEP_DT_S), s.cfg);
    s.y = next.y;
    s.v = next.v;
    void s.win
      .setPositionPhysical(Math.round(s.x), Math.round(s.y))
      .catch((err) => log.warn("move_failed", { degrade: true, error: String(err) }));
    if (!next.landed) return;
    const heightPx = s.heightPx;
    clear();
    renderer.playMotion({ id: LAND_MOTION_ID });
    reportLanding(heightPx);
    deps.onEnd();
  }

  async function begin(): Promise<void> {
    const startedAt = generation;
    const cfg = deps.getConfig();
    // Feet in canvas-local logical px; the window bottom sits well below them.
    const feet = renderer.getCharacterAnchor();
    const probe = renderer.getPerchProbe();
    const win = deps.getWindow();
    const [pos, sf, monitors] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      deps.listMonitors(),
    ]);
    if (stopped || generation !== startedAt) return;
    if (!feet || !probe) return;
    const monitor = monitorAt(monitors, pos.x, pos.y);
    if (!monitor) return;
    const scale = sf > 0 ? sf : 1;
    const windowY = pos.y / scale;
    const plan = planFall({
      windowY,
      feetY: windowY + feet.y,
      floorY: floorPx(monitor, scale),
      charHpx: probe.charHpx,
      cfg,
      tolerancePx: deps.getFloorTolerancePx(),
    });
    if (plan.kind === "none") return;
    const toY = Math.round(plan.toY * scale);
    // A drop too short to read as a fall, or a user who asked for no motion: land her there.
    if (plan.kind === "snap" || reducedMotion()) {
      await win.setPositionPhysical(pos.x, toY);
      if (plan.kind === "fall") reportLanding(plan.heightPx);
      return;
    }
    // The pickup clip may still hold the body this early after the release; the descent
    // starts anyway and step() takes the clip once the body is back on the baseline.
    renderer.playMotion({ id: FALL_MOTION_ID });
    fall = {
      x: pos.x,
      y: pos.y,
      v: 0,
      toY,
      heightPx: plan.heightPx,
      win,
      cfg: {
        ...cfg,
        gravity_px_s2: cfg.gravity_px_s2 * scale,
        max_speed_px_s: cfg.max_speed_px_s * scale,
      },
    };
    unsub = renderer.onTick((ctx) => step(ctx.dt));
    deps.onStart();
  }

  return {
    async drop() {
      if (stopped || fall || starting) return;
      starting = true;
      try {
        await begin();
      } catch (err) {
        log.warn("fall_start_failed", { degrade: true, error: String(err) });
      } finally {
        starting = false;
      }
    },
    cancel() {
      endFall();
    },
    stop() {
      stopped = true;
      endFall();
    },
  };
}
