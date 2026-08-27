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
 * Pure scheduling/geometry lives in the exported functions; createWalker owns the timer,
 * the async window reads, and the per-frame translation.
 */

import type { WalkConfig } from "../config/load";
import type { MotionKind } from "../contract";
import { clampToWorkArea } from "../drag";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { type Rng, randRange } from "./cues";
import { prefersReducedMotion } from "./tier1";

const log = createLogger("walker");

/** Registry id of the in-place walk clip. */
export const WALK_MOTION_ID = "walk";
/** Mixamo "Walking" advances this far per cycle at playback rate 1.0. */
export const WALK_METRES_PER_CYCLE = 1.34;
/** Length of one Mixamo "Walking" cycle (s). */
export const WALK_CYCLE_S = 1.37;
/** Root yaw (rad) toward the travel direction — a quarter turn off camera-facing. */
export const WALK_YAW_RAD = Math.PI / 2;
/** Yaw ease (ms), run concurrently with the motion crossfade at both ends of a stroll. */
export const WALK_YAW_EASE_MS = 400;

/** Delay (ms) until the next stroll attempt. */
export function nextWalkDelay(cfg: WalkConfig, rng: Rng = Math.random): number {
  return randRange(cfg.interval_min_ms, cfg.interval_max_ms, rng);
}

/** Ground speed (px/s) of the walk clip at a given px-per-metre framing. */
export function walkSpeedPxPerSec(pxPerMetre: number): number {
  return (pxPerMetre * WALK_METRES_PER_CYCLE) / WALK_CYCLE_S;
}

/** Whether the window bottom rests on the work-area bottom, within tolerance. */
export function onFloor(windowBottomPx: number, floorPx: number, tolerancePx: number): boolean {
  return Math.abs(windowBottomPx - floorPx) <= tolerancePx;
}

/** Everything that can keep a stroll from starting, sampled at fire time. */
export interface WalkGateState {
  onFloor: boolean;
  perched: boolean;
  peeking: boolean;
  dragging: boolean;
  /** The committed motion is the ambient baseline — no speech/thinking/reactive motion holds the body. */
  ambientMotion: boolean;
  reducedMotion: boolean;
}

export function canStartStroll(s: WalkGateState): boolean {
  return (
    s.onFloor && !s.perched && !s.peeking && !s.dragging && s.ambientMotion && !s.reducedMotion
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

/** Pet window accessors the stroll reads and writes. Positions/sizes are physical px. */
export interface WalkerWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
  setPositionPhysical(x: number, y: number): Promise<void>;
}

/** One monitor's physical bounds plus its work area. */
export interface WalkerMonitor {
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
}

export interface WalkerDeps {
  renderer: Pick<
    Renderer,
    "onTick" | "playMotion" | "getCurrentMotion" | "setBodyYaw" | "getPxPerMetre" | "isPerched"
  >;
  getWindow(): WalkerWindow;
  listMonitors(): Promise<WalkerMonitor[]>;
  getConfig(): WalkConfig;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
  isPeeking(): boolean;
  isDragging(): boolean;
  /** A stroll began — posture goes walking and the hit test follows the moving window. */
  onStart(): void;
  /** The stroll arrived, was cancelled, or lost the clip. */
  onEnd(): void;
  rng?: Rng;
}

export interface Walker {
  /** Register the frame hook and arm the first interval. */
  start(): void;
  /** End a running stroll now and rearm the interval. */
  cancel(): void;
  stop(): void;
  isWalking(): boolean;
}

/** Index of the monitor whose bounds contain the point, or null. */
function monitorAt(monitors: WalkerMonitor[], x: number, y: number): WalkerMonitor | null {
  return (
    monitors.find(
      (m) =>
        x >= m.position.x &&
        x < m.position.x + m.size.width &&
        y >= m.position.y &&
        y < m.position.y + m.size.height,
    ) ?? null
  );
}

export function createWalker(deps: WalkerDeps): Walker {
  const { renderer } = deps;
  const rng = deps.rng ?? Math.random;

  let unsub: (() => void) | null = null;
  /** Frame-clock deadline (ms) for the next attempt; negative = needs arming. */
  let nextAtMs = -1;
  /** Live stroll, all in physical px. */
  let stroll: { x: number; y: number; toX: number; speedPxPerSec: number } | null = null;
  /** True while the async fire-time reads are in flight. */
  let starting = false;
  /** Bumped by every cancel/stop so an in-flight begin() drops its plan. */
  let generation = 0;
  let stopped = true;
  let reduce = false;
  let mql: MediaQueryList | null = null;

  const onReduceChange = (e: MediaQueryListEvent): void => {
    reduce = e.matches;
    if (reduce) endStroll();
  };

  /** End the stroll and rearm. Leaves the clip alone when something else already took it. */
  function endStroll(): void {
    generation += 1;
    if (!stroll) return;
    stroll = null;
    nextAtMs = -1;
    if (renderer.getCurrentMotion()?.id === WALK_MOTION_ID) renderer.playMotion(null);
    renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
    deps.onEnd();
  }

  async function begin(): Promise<void> {
    const startedAt = generation;
    const cfg = deps.getConfig();
    const pxPerMetre = renderer.getPxPerMetre();
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
    const floorPx = (work.position.y + work.size.height) / scale;
    const gate: WalkGateState = {
      onFloor: onFloor((pos.y + size.height) / scale, floorPx, cfg.floor_tolerance_px),
      perched: renderer.isPerched(),
      peeking: deps.isPeeking(),
      dragging: deps.isDragging(),
      ambientMotion: deps.currentMotionKind() === "ambient",
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
    stroll = {
      x: pos.x,
      y: pos.y,
      toX: plan.toX * scale,
      speedPxPerSec: walkSpeedPxPerSec(pxPerMetre) * scale,
    };
    renderer.playMotion({ id: WALK_MOTION_ID });
    renderer.setBodyYaw(plan.direction * WALK_YAW_RAD, WALK_YAW_EASE_MS);
    deps.onStart();
  }

  /** One frame of translation. A replaced clip means a reactive motion took the body. */
  function step(dt: number): void {
    const s = stroll;
    if (!s) return;
    if (renderer.getCurrentMotion()?.id !== WALK_MOTION_ID) {
      endStroll();
      return;
    }
    s.x = advanceX(s.x, s.toX, s.speedPxPerSec, dt);
    void deps
      .getWindow()
      .setPositionPhysical(Math.round(s.x), s.y)
      .catch((err) => log.warn("move_failed", { degrade: true, error: String(err) }));
    if (s.x === s.toX) endStroll();
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
      unsub = renderer.onTick(tick);
    },
    cancel() {
      endStroll();
    },
    stop() {
      stopped = true;
      endStroll();
      unsub?.();
      unsub = null;
      if (mql) {
        mql.removeEventListener("change", onReduceChange);
        mql = null;
      }
    },
    isWalking() {
      return stroll !== null;
    },
  };
}
