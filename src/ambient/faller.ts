/**
 * Falling — a character left in mid-air drops to the first surface below her.
 *
 * Presentation only, no judgment: the client fires the fall, the backend decides
 * whether to say anything about it. The VRM stays at scene origin playing the
 * `falling` clip while a per-frame loop accelerates the OS window down to the surface
 * that catches her — a foreign window top with standing room, or the work-area floor —
 * then `landing` plays and the registry returns her to idle. The stack is re-read on the
 * perch poll cadence as she descends, so a window that slides in or out mid-fall counts.
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
import type { MotionKind, WindowRect } from "../contract";
import { floorPx, monitorAt, type PetWindow, type ScreenMonitor } from "../io/screen-geometry";
import { PERCH_POLL_MS, uncoveredSpan } from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { prefersReducedMotion } from "./tier1";
import { MAX_STEP_DT_S } from "./walker";

const log = createLogger("faller");

/** Registry id of the looping descent clip. */
export const FALL_MOTION_ID = "falling";
/** Registry id of the touchdown clip. */
export const LAND_MOTION_ID = "landing";

/** Where a fall stops: a foreign window's top edge, or the work-area floor. */
export type LandingSurface =
  | { kind: "floor"; y: number }
  | { kind: "window"; y: number; target: WindowRect };

/** What the touchdown reports: how far she fell and what she came down on. */
export interface FallLanding {
  heightPx: number;
  surface: LandingSurface;
}

/**
 * The surface a fall from `x` stops on: the highest window top below the feet that she
 * could stand on, and the floor when none can be.
 *
 * A top qualifies when its uncovered stretch at `x` leaves `roomPx` of standing room
 * either side — which is also what rules out an x off the window's end or under a window
 * in front of it — and when the work area would not clamp her off the edge she landed on.
 * Ties go to the front-most window, and a top below the floor line is past the floor.
 */
export function pickLandingSurface(args: {
  /** Front-to-back, topmost first. */
  windows: WindowRect[];
  /** Global x (logical px) the feet fall down. */
  x: number;
  /** Global y of the feet anchor now. */
  feetY: number;
  floorY: number;
  roomPx: number;
  /** Highest window top she can stand on: the work-area top plus the feet offset. */
  minStandingTop: number;
}): LandingSurface {
  const { windows, x, feetY, floorY, roomPx, minStandingTop } = args;
  let best: { y: number; target: WindowRect } | null = null;
  for (const [index, candidate] of windows.entries()) {
    if (candidate.y <= feetY || candidate.y >= floorY) continue;
    if (candidate.y < minStandingTop) continue;
    if (best !== null && candidate.y >= best.y) continue;
    const span = uncoveredSpan(windows, index, x);
    if (x - roomPx < span.left || x + roomPx > span.right) continue;
    best = { y: candidate.y, target: candidate };
  }
  return best === null ? { kind: "floor", y: floorY } : { kind: "window", ...best };
}

/** What a drop resolves to: nothing to do, a silent snap, or a fall. */
export type FallPlan =
  | { kind: "none" }
  | { kind: "snap"; toY: number; heightPx: number }
  | { kind: "fall"; toY: number; heightPx: number };

/**
 * One drop: how far the feet are above the surface below decides between nothing, a snap
 * and a fall. All arguments and results are logical px; `toY` is the window y that grounds
 * the feet.
 */
export function planFall(args: {
  /** Window origin y. */
  windowY: number;
  /** Global y of the feet anchor. */
  feetY: number;
  /** Global y of the surface that catches the fall. */
  surfaceY: number;
  /** On-screen character height — the min-drop threshold scales with the framing. */
  charHpx: number;
  cfg: FallConfig;
  tolerancePx: number;
}): FallPlan {
  const { windowY, feetY, surfaceY, charHpx, cfg, tolerancePx } = args;
  const drop = surfaceY - feetY;
  if (drop <= tolerancePx) return { kind: "none" };
  const toY = windowY + drop;
  const kind = drop < charHpx * cfg.min_drop_frac ? "snap" : "fall";
  return { kind, toY, heightPx: drop };
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
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "getCharacterAnchor"
    | "getPerchProbe"
    | "getCharacterWidthPx"
  >;
  getWindow(): PetWindow;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
  listMonitors(): Promise<ScreenMonitor[]>;
  /** Foreign windows, front-to-back — re-read on the poll cadence while she descends. */
  listWindows(): Promise<WindowRect[]>;
  getConfig(): FallConfig;
  /** How far the feet may sit from the floor and still count as grounded (logical px). */
  getFloorTolerancePx(): number;
  /** Defaults to the OS setting; injected in tests. */
  reducedMotion?: () => boolean;
  /** Injectable clock for the cue cooldown; defaults to Date.now. */
  now?: () => number;
  /** The descent began — the hit test follows the moving window. */
  onStart(): void;
  /** Touchdown, carrying the height fallen in logical px and the surface she is on. */
  onLand(landing: FallLanding): void;
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

/** A descent in flight and everything the surface refresh re-decides it against. */
interface Fall {
  x: number;
  y: number;
  v: number;
  toY: number;
  /** Config scaled to physical px, so the descent reads the same at any scale factor. */
  cfg: FallConfig;
  win: PetWindow;
  scale: number;
  /** Feet offset inside the pet window, logical px. */
  anchorY: number;
  /** Global x the feet fall down, logical px. */
  feetX: number;
  /** Global y the feet left, logical px — the height fallen is measured from it. */
  startFeetY: number;
  floorY: number;
  /** Standing room a window top needs either side of her, null when the width is unreadable. */
  roomPx: number | null;
  minStandingTop: number;
  surface: LandingSurface;
  /** Seconds since the last stack read, against the poll cadence. */
  sinceReadS: number;
  /** A stack read is out; the next cadence tick leaves it alone. */
  reading: boolean;
}

/** How a surface reads in a log line. */
function surfaceLabel(surface: LandingSurface): string {
  return surface.kind === "floor" ? "floor" : `window:${surface.target.windowNumber}`;
}

/** Whether two picks name the same edge in the same place. */
function sameSurface(a: LandingSurface, b: LandingSurface): boolean {
  if (a.kind !== b.kind || a.y !== b.y) return false;
  return (
    a.kind === "floor" || b.kind === "floor" || a.target.windowNumber === b.target.windowNumber
  );
}

export function createFaller(deps: FallerDeps): Faller {
  const { renderer } = deps;
  const now = deps.now ?? Date.now;
  const reducedMotion = deps.reducedMotion ?? prefersReducedMotion;

  let unsub: (() => void) | null = null;
  /** Live descent; positions are physical px, the surface geometry is logical. */
  let fall: Fall | null = null;
  /** True while the async drop-time reads are in flight. */
  let starting = false;
  /** Bumped by every cancel/stop so an in-flight begin() drops its plan. */
  let generation = 0;
  let stopped = false;
  let lastCueAtMs = Number.NEGATIVE_INFINITY;

  /**
   * Report the touchdown: the signal always, the speech candidate on its own cooldown and
   * only for a drop long enough to have been a fall.
   */
  function reportLanding(heightPx: number, surface: LandingSurface, cueable: boolean): void {
    log.info("fall_landed", {
      landed_on: surface.kind,
      windowNumber: surface.kind === "window" ? surface.target.windowNumber : null,
      heightPx: Math.round(heightPx),
    });
    deps.onLand({ heightPx, surface });
    if (!cueable) return;
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

  /**
   * Re-pick the surface under the descent on the poll cadence. One read at a time, and a
   * result that outlives its fall is dropped. A surface that moved away simply stops
   * catching her; the fall carries on to the next one or the floor.
   */
  function refreshSurface(s: Fall, dt: number): void {
    const roomPx = s.roomPx;
    if (roomPx === null) return;
    s.sinceReadS += dt;
    if (s.sinceReadS * 1000 < PERCH_POLL_MS || s.reading) return;
    s.sinceReadS = 0;
    s.reading = true;
    const startedAt = generation;
    void deps
      .listWindows()
      .then((windows) => {
        if (generation !== startedAt || fall !== s) return;
        const next = pickLandingSurface({
          windows,
          x: s.feetX,
          feetY: s.y / s.scale + s.anchorY,
          floorY: s.floorY,
          roomPx,
          minStandingTop: s.minStandingTop,
        });
        if (sameSurface(next, s.surface)) return;
        log.debug("fall_retarget", { from: surfaceLabel(s.surface), to: surfaceLabel(next) });
        s.surface = next;
        s.toY = Math.round((next.y - s.anchorY) * s.scale);
      })
      .catch((err) => log.warn("surface_read_failed", { degrade: true, error: String(err) }))
      .finally(() => {
        s.reading = false;
      });
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
    refreshSurface(s, dt);
    const next = stepFall(s, Math.min(dt, MAX_STEP_DT_S), s.cfg);
    s.y = next.y;
    s.v = next.v;
    void s.win
      .setPositionPhysical(Math.round(s.x), Math.round(s.y))
      .catch((err) => log.warn("move_failed", { degrade: true, error: String(err) }));
    if (!next.landed) return;
    const surface = s.surface;
    const heightPx = surface.y - s.startFeetY;
    clear();
    renderer.playMotion({ id: LAND_MOTION_ID });
    reportLanding(heightPx, surface, true);
    deps.onEnd();
  }

  async function begin(): Promise<void> {
    const startedAt = generation;
    const cfg = deps.getConfig();
    // Feet in canvas-local logical px; the window bottom sits well below them.
    const feet = renderer.getCharacterAnchor();
    const probe = renderer.getPerchProbe();
    const charWpx = renderer.getCharacterWidthPx();
    const win = deps.getWindow();
    // Without a width there is no standing-room test, so nothing but the floor can catch her.
    const roomPx = charWpx === null ? null : cfg.land_room_frac * charWpx;
    const [pos, sf, monitors, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      deps.listMonitors(),
      roomPx === null ? Promise.resolve([]) : deps.listWindows(),
    ]);
    if (stopped || generation !== startedAt) return;
    if (!feet || !probe) return;
    const monitor = monitorAt(monitors, pos.x, pos.y);
    if (!monitor) return;
    const scale = sf > 0 ? sf : 1;
    const windowY = pos.y / scale;
    const feetY = windowY + feet.y;
    const feetX = pos.x / scale + feet.x;
    const floorY = floorPx(monitor, scale);
    const minStandingTop = monitor.workArea.position.y / scale + feet.y;
    const surface = pickLandingSurface({
      windows,
      x: feetX,
      feetY,
      floorY,
      roomPx: roomPx ?? 0,
      minStandingTop,
    });
    const plan = planFall({
      windowY,
      feetY,
      surfaceY: surface.y,
      charHpx: probe.charHpx,
      cfg,
      tolerancePx: deps.getFloorTolerancePx(),
    });
    if (plan.kind === "none") return;
    log.debug("fall_surface", {
      kind: surface.kind,
      windowNumber: surface.kind === "window" ? surface.target.windowNumber : null,
      toY: Math.round(plan.toY),
    });
    const toY = Math.round(plan.toY * scale);
    // A drop too short to read as a fall, or a user who asked for no motion: land her there.
    // A window top still owes the hand-off that puts her back on a perch.
    if (plan.kind === "snap" || reducedMotion()) {
      await win.setPositionPhysical(pos.x, toY);
      if (plan.kind === "fall" || surface.kind === "window") {
        reportLanding(plan.heightPx, surface, plan.kind === "fall");
      }
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
      win,
      scale,
      anchorY: feet.y,
      feetX,
      startFeetY: feetY,
      floorY,
      roomPx,
      minStandingTop,
      surface,
      sinceReadS: 0,
      reading: false,
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
