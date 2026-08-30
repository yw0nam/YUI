/**
 * Ambient floor walking — the character occasionally strolls left/right along the
 * bottom of the current monitor's work area.
 *
 * Presentation only, no judgment: a stroll is a client-scheduled ambient cue. The VRM
 * stays at scene origin playing the in-place `walk` clip while a per-frame loop
 * translates the OS window along the floor line, and the root yaws toward the travel
 * direction. Speed is derived from the clip's own ground speed through the renderer's
 * world↔px projection, so the feet never slide at any window size or scale factor.
 *
 * Ownership is user > agent > ambient: a drag, an agent command, a perch placement,
 * reduced motion, or any higher-priority motion taking the clip ends the stroll at once.
 *
 * The same machinery serves `walkTo`, a directed walk to a given x that skips the interval
 * and the floor gate: the caller vouches for the surface and reports its own posture, so
 * one call walks the floor and a foreign window's top edge alike.
 *
 * Pure scheduling/geometry lives in the exported functions; createWalker owns the timer,
 * the async window reads, and the per-frame translation.
 */

import type { WalkConfig } from "../config/load";
import type { MotionKind } from "../contract";
import { clampToWorkArea } from "../drag";
import { floorPx, monitorAt, type PetWindow, type ScreenMonitor } from "../io/screen-geometry";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { type Rng, randRange } from "./cues";
import { prefersReducedMotion } from "./tier1";

const log = createLogger("walker");

/** Registry id of the in-place walk clip. */
export const WALK_MOTION_ID = "walk";
/** Mixamo "Walking" advances this far per cycle at playback rate 1.0. */
export const WALK_METRES_PER_CYCLE = 1.34;
/** Root yaw (rad) toward the travel direction — a quarter turn off camera-facing. */
export const WALK_YAW_RAD = Math.PI / 2;
/** Yaw ease (ms), run concurrently with the motion crossfade at both ends of a stroll. */
export const WALK_YAW_EASE_MS = 400;
/** Frame-delta cap (s) — an idle-throttled or backgrounded gap must not teleport the window. */
export const MAX_STEP_DT_S = 0.1;

/** Delay (ms) until the next stroll attempt. */
export function nextWalkDelay(cfg: WalkConfig, rng: Rng = Math.random): number {
  return randRange(cfg.interval_min_ms, cfg.interval_max_ms, rng);
}

/** Ground speed (px/s) of the walk clip: one stride per loop of the clip's own cycle. */
export function walkSpeedPxPerSec(pxPerMetre: number, cycleS: number): number {
  return (pxPerMetre * WALK_METRES_PER_CYCLE) / cycleS;
}

/** Whether the character's feet rest on the work-area bottom, within tolerance. */
export function onFloor(feetPx: number, floorPx: number, tolerancePx: number): boolean {
  return Math.abs(feetPx - floorPx) <= tolerancePx;
}

/** Everything that can keep a stroll from starting, sampled at fire time. */
export interface WalkGateState {
  /** The feet, not the window bottom — the framing margin leaves headroom under the model. */
  onFloor: boolean;
  perched: boolean;
  peeking: boolean;
  dragging: boolean;
  /** The committed motion is the ambient baseline — no speech/thinking/reactive motion holds the body. */
  ambientMotion: boolean;
  /** A turn is in flight or speech is still playing. Reflex turns skip thinking, so the motion alone misses them. */
  busy: boolean;
  reducedMotion: boolean;
}

export function canStartStroll(s: WalkGateState): boolean {
  return (
    s.onFloor &&
    !s.perched &&
    !s.peeking &&
    !s.dragging &&
    s.ambientMotion &&
    !s.busy &&
    !s.reducedMotion
  );
}

export interface StrollPlan {
  /** Window left edge at the destination, clamped into the work area. */
  toX: number;
  /** -1 travels left, 1 travels right. */
  direction: -1 | 1;
}

/**
 * One stroll: a random direction and distance, clamped to the work area.
 * All arguments and results are logical px. null when the drawn direction leaves no room.
 */
export function planStroll(args: {
  x: number;
  width: number;
  workX: number;
  workWidth: number;
  cfg: WalkConfig;
  rng?: Rng;
}): StrollPlan | null {
  const { x, width, workX, workWidth, cfg } = args;
  const rng = args.rng ?? Math.random;
  const distance = randRange(cfg.distance_min_px, cfg.distance_max_px, rng);
  const direction: -1 | 1 = rng() < 0.5 ? -1 : 1;
  if (width > workWidth) return null;
  const toX = clampToWorkArea(x + direction * distance, 0, width, 0, workX, 0, workWidth, 0).x;
  return toX === x ? null : { toX, direction };
}

/** Window x after one dt step toward the destination, never past it. */
export function advanceX(x: number, toX: number, speedPxPerSec: number, dt: number): number {
  const remaining = toX - x;
  const step = speedPxPerSec * dt;
  return Math.abs(remaining) <= step ? toX : x + Math.sign(remaining) * step;
}

/** Document seam for the hidden-window guard — the renderer parks its rAF while hidden. */
export interface WalkerDoc {
  visibilityState: string;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
}

export interface WalkerDeps {
  renderer: Pick<
    Renderer,
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "setBodyYaw"
    | "getPxPerMetre"
    | "getMotionDuration"
    | "getCharacterAnchor"
    | "isPerched"
  >;
  getWindow(): PetWindow;
  listMonitors(): Promise<ScreenMonitor[]>;
  getConfig(): WalkConfig;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
  isPeeking(): boolean;
  isDragging(): boolean;
  /** A turn is in flight or speech is still playing. */
  isBusy(): boolean;
  /** Defaults to the global document; injected in tests. */
  doc?: WalkerDoc;
  /** A stroll began — posture goes walking and the hit test follows the moving window. */
  onStart(): void;
  /** The stroll arrived, was cancelled, or lost the clip. */
  onEnd(): void;
  rng?: Rng;
}

export interface Walker {
  /** Register the frame hook and arm the first interval. */
  start(): void;
  /**
   * Walk to a window x (logical px), no interval and no floor/perch gate — the caller
   * vouches for the surface and owns the posture, so the same call walks the work-area
   * floor and a foreign window's top edge. Cancels a running stroll first.
   */
  walkTo(toX: number): Promise<"arrived" | "lost">;
  /** End a running stroll now and rearm the interval. */
  cancel(): void;
  stop(): void;
}

export function createWalker(deps: WalkerDeps): Walker {
  const { renderer } = deps;
  const rng = deps.rng ?? Math.random;

  let unsub: (() => void) | null = null;
  /** Frame-clock deadline (ms) for the next attempt; negative = needs arming. */
  let nextAtMs = -1;
  /** Live stroll, all in physical px. */
  let stroll: {
    x: number;
    y: number;
    toX: number;
    pxPerMetre: number;
    win: PetWindow;
    /** A walkTo the caller owns: it reports the outcome itself and holds the posture. */
    directed: boolean;
  } | null = null;
  /** Settles the walkTo promise when a directed walk ends. */
  let resolveWalk: ((outcome: "arrived" | "lost") => void) | null = null;
  /** True while the async fire-time reads are in flight. */
  let starting = false;
  /** Bumped by every cancel/stop so an in-flight begin() drops its plan. */
  let generation = 0;
  let stopped = true;
  let reduce = false;
  let mql: MediaQueryList | null = null;
  const doc = deps.doc ?? (typeof document === "undefined" ? null : document);

  const onReduceChange = (e: MediaQueryListEvent): void => {
    reduce = e.matches;
    if (reduce) endStroll();
  };
  // The renderer parks its rAF while hidden, so a stroll left running would strand
  // the posture at walking and hold the hit test in per-tick mode.
  const onVisibilityChange = (): void => {
    if (doc?.visibilityState === "hidden") endStroll();
  };

  /** End the stroll and rearm. Leaves the clip alone when something else already took it. */
  function endStroll(outcome: "arrived" | "lost" = "lost"): void {
    generation += 1;
    const s = stroll;
    if (!s) return;
    stroll = null;
    nextAtMs = -1;
    if (renderer.getCurrentMotion()?.id === WALK_MOTION_ID) renderer.playMotion(null);
    renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
    const settle = resolveWalk;
    resolveWalk = null;
    if (!s.directed) deps.onEnd();
    settle?.(outcome);
  }

  async function begin(): Promise<void> {
    const startedAt = generation;
    const cfg = deps.getConfig();
    const pxPerMetre = renderer.getPxPerMetre();
    // Feet in canvas-local logical px; the window bottom sits well below them.
    const feet = renderer.getCharacterAnchor();
    const win = deps.getWindow();
    const [pos, size, sf, monitors] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
      deps.listMonitors(),
    ]);
    if (stopped || generation !== startedAt) return;
    const monitor = monitorAt(monitors, pos.x, pos.y);
    if (!monitor || pxPerMetre === null || !(pxPerMetre > 0)) return;
    const scale = sf > 0 ? sf : 1;
    const work = monitor.workArea;
    const floor = floorPx(monitor, scale);
    const gate: WalkGateState = {
      onFloor: feet !== null && onFloor(pos.y / scale + feet.y, floor, cfg.floor_tolerance_px),
      perched: renderer.isPerched(),
      peeking: deps.isPeeking(),
      dragging: deps.isDragging(),
      ambientMotion: deps.currentMotionKind() === "ambient",
      busy: deps.isBusy(),
      reducedMotion: reduce,
    };
    if (!canStartStroll(gate)) return;
    const plan = planStroll({
      x: pos.x / scale,
      width: size.width / scale,
      workX: work.position.x / scale,
      workWidth: work.size.width / scale,
      cfg,
      rng,
    });
    if (!plan) return;
    renderer.playMotion({ id: WALK_MOTION_ID });
    // A dropped request (perch suppression, dead clip) must not leave a walk_start/walk_end blip.
    if (renderer.getCurrentMotion()?.id !== WALK_MOTION_ID) return;
    stroll = {
      x: pos.x,
      y: pos.y,
      toX: plan.toX * scale,
      pxPerMetre: pxPerMetre * scale,
      win,
      directed: false,
    };
    renderer.setBodyYaw(plan.direction * WALK_YAW_RAD, WALK_YAW_EASE_MS);
    deps.onStart();
  }

  /** Set up a directed walk. "running" means the frame loop owns it from here. */
  async function beginWalkTo(toX: number): Promise<"arrived" | "lost" | "running"> {
    const startedAt = generation;
    const pxPerMetre = renderer.getPxPerMetre();
    const win = deps.getWindow();
    const [pos, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    if (stopped || generation !== startedAt) return "lost";
    if (pxPerMetre === null || !(pxPerMetre > 0)) return "lost";
    const scale = sf > 0 ? sf : 1;
    const target = toX * scale;
    if (pos.x === target) return "arrived";
    renderer.playMotion({ id: WALK_MOTION_ID });
    if (renderer.getCurrentMotion()?.id !== WALK_MOTION_ID) return "lost";
    stroll = {
      x: pos.x,
      y: pos.y,
      toX: target,
      pxPerMetre: pxPerMetre * scale,
      win,
      directed: true,
    };
    renderer.setBodyYaw(Math.sign(target - pos.x) * WALK_YAW_RAD, WALK_YAW_EASE_MS);
    return "running";
  }

  /** One frame of translation. A replaced clip means a reactive motion took the body. */
  function step(dt: number): void {
    const s = stroll;
    if (!s) return;
    if (renderer.getCurrentMotion()?.id !== WALK_MOTION_ID) {
      // An ambient stroll yields the body the moment anything else takes the clip. A
      // directed walk is one leg of the caller's sequence, so it holds where it is and
      // reclaims the clip once the ambient baseline hands it back — ending it instead
      // would strand a caller that has already committed to the walk.
      if (!s.directed) {
        endStroll();
        return;
      }
      if (deps.currentMotionKind() === "ambient") renderer.playMotion({ id: WALK_MOTION_ID });
      return;
    }
    // The clip paces the feet — until it is cached there is no cycle to walk at.
    const cycleS = renderer.getMotionDuration(WALK_MOTION_ID);
    if (cycleS === null || !(cycleS > 0)) return;
    const speed = walkSpeedPxPerSec(s.pxPerMetre, cycleS);
    s.x = advanceX(s.x, s.toX, speed, Math.min(dt, MAX_STEP_DT_S));
    void s.win
      .setPositionPhysical(Math.round(s.x), s.y)
      .catch((err) => log.warn("move_failed", { degrade: true, error: String(err) }));
    if (s.x === s.toX) endStroll("arrived");
  }

  function tick(ctx: { dt: number; elapsed: number }): void {
    const tMs = ctx.elapsed * 1000;
    if (stroll) {
      step(ctx.dt);
      return;
    }
    if (nextAtMs < 0) {
      nextAtMs = tMs + nextWalkDelay(deps.getConfig(), rng);
      return;
    }
    if (tMs < nextAtMs || starting) return;
    nextAtMs = tMs + nextWalkDelay(deps.getConfig(), rng);
    starting = true;
    void begin()
      .catch((err) => log.warn("stroll_start_failed", { degrade: true, error: String(err) }))
      .finally(() => {
        starting = false;
      });
  }

  return {
    start() {
      if (unsub) return;
      stopped = false;
      nextAtMs = -1;
      reduce = prefersReducedMotion();
      try {
        if (typeof matchMedia === "function") {
          mql = matchMedia("(prefers-reduced-motion: reduce)");
          mql.addEventListener("change", onReduceChange);
        }
      } catch {
        /* matchMedia unavailable (tests, etc.) — ignore */
      }
      doc?.addEventListener("visibilitychange", onVisibilityChange);
      unsub = renderer.onTick(tick);
    },
    async walkTo(toX) {
      endStroll();
      starting = true;
      let outcome: "arrived" | "lost" | "running";
      try {
        outcome = await beginWalkTo(toX);
      } finally {
        starting = false;
      }
      if (outcome !== "running") return outcome;
      return new Promise((resolve) => {
        resolveWalk = resolve;
      });
    },
    cancel() {
      endStroll();
    },
    stop() {
      stopped = true;
      endStroll();
      unsub?.();
      unsub = null;
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
      if (mql) {
        mql.removeEventListener("change", onReduceChange);
        mql = null;
      }
    },
  };
}
