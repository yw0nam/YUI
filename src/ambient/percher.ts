/**
 * Ambient perched walking — while the character sits on a foreign window she dwells,
 * stands up on the window's top edge, strolls a short way along it, and sits back down.
 *
 * The sit pin is suspended for the length of the walk and restored from wherever the
 * window actually landed, so the loop owns the seat the whole time: it either resumes it
 * or abandons it, and only a lost host takes the published exit path.
 */

import type { PerchWalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import { monitorAt, type ScreenMonitor } from "../io/screen-geometry";
import { MOVE_TH, PERCH_AMBIGUOUS_LOST_TICKS, PERCH_POLL_MS } from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { TickFn } from "../renderer";
import { prefersReducedMotion } from "./tier1";

const log = createLogger("percher");

type Rng = () => number;

export function nextPerchDwell(cfg: PerchWalkConfig, rng: Rng = Math.random): number {
  return cfg.dwell_min_ms + (cfg.dwell_max_ms - cfg.dwell_min_ms) * rng();
}

export function planPerchStroll(opts: {
  currentX: number;
  winLeft: number;
  winRight: number;
  charHpx: number;
  cfg: PerchWalkConfig;
  rng?: Rng;
}): { centerX: number; direction: -1 | 1 } | null {
  const rng = opts.rng ?? Math.random;
  const margin = opts.cfg.edge_margin_frac * opts.charHpx;
  const left = opts.winLeft + margin;
  const right = opts.winRight - margin;
  if (right < left) return null;
  const roomLeft = opts.currentX - left;
  const roomRight = right - opts.currentX;
  const leftOk = roomLeft >= opts.cfg.distance_min_px;
  const rightOk = roomRight >= opts.cfg.distance_min_px;
  if (!leftOk && !rightOk) return null;
  const direction: -1 | 1 = leftOk && rightOk ? (rng() < 0.5 ? -1 : 1) : leftOk ? -1 : 1;
  const room = direction < 0 ? roomLeft : roomRight;
  const max = Math.min(opts.cfg.distance_max_px, room);
  const distance = opts.cfg.distance_min_px + (max - opts.cfg.distance_min_px) * rng();
  const centerX = Math.min(right, Math.max(left, opts.currentX + direction * distance));
  return { centerX, direction };
}

interface PercherWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
  setPositionPhysical(x: number, y: number): Promise<void>;
}

interface SuspendedSit {
  windowNumber: number;
  origin: "commit" | "adopt";
  rect: { x: number; y: number };
  charHpx: number;
}

export interface PercherDeps {
  renderer: {
    onTick(fn: TickFn): () => void;
    getCharacterAnchor(): { x: number; y: number } | null;
    getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  };
  getWindow(): PercherWindow;
  listWindows(): Promise<WindowRect[]>;
  listMonitors(): Promise<ScreenMonitor[]>;
  getConfig(): PerchWalkConfig;
  walker: {
    walkTo(toX: number, onAccepted?: () => void): Promise<"arrived" | "lost">;
    cancel(): void;
  };
  dropSource: {
    armedSit(): { windowNumber: number; origin: "commit" | "adopt" } | null;
    suspendSit(): SuspendedSit | null;
    resumeSit(edgeLocalYpx: number): void;
    abandonSit(): void;
    release(): void;
  };
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
  /** A turn is in flight or speech is still playing. */
  isBusy(): boolean;
  onWalkStart(): void;
  onWalkEnd(): void;
  onWalkCancel(): void;
  onSit(target: WindowRect, edgeLocalYpx: number): void;
  rng?: Rng;
  /** Defaults to the OS setting; injected in tests. */
  reducedMotion?: () => boolean;
}

export interface Percher {
  start(): void;
  cancel(): void;
  stop(): void;
}

export function createPercher(deps: PercherDeps): Percher {
  const rng = deps.rng ?? Math.random;
  const reducedMotion = deps.reducedMotion ?? prefersReducedMotion;
  let unsub: (() => void) | null = null;
  let stopped = true;
  let generation = 0;
  let dwellAtMs = -1;
  let nowMs = 0;
  let starting = false;
  /** Generation holding a suspended sit, if any — whoever owns it must resume or abandon it. */
  let suspendedAt: number | null = null;
  let stroll: {
    host: WindowRect;
    nextWatchAtMs: number;
    lostStreak: number;
    watching: boolean;
  } | null = null;

  function alive(startedAt: number): boolean {
    return !stopped && generation === startedAt;
  }

  /** Drop a live suspension without a cue — the seat is gone and nothing announces it. */
  function abandonSuspension(): void {
    if (suspendedAt === null) return;
    suspendedAt = null;
    deps.dropSource.abandonSit();
  }

  function rearmDwell(): void {
    dwellAtMs = nowMs + nextPerchDwell(deps.getConfig(), rng);
  }

  function cancel(): void {
    generation++;
    dwellAtMs = -1;
    starting = false;
    if (stroll) {
      deps.walker.cancel();
      deps.onWalkCancel();
    }
    stroll = null;
    abandonSuspension();
  }

  function loseHost(startedAt: number): void {
    if (!alive(startedAt) || !stroll) return;
    generation++;
    stroll = null;
    dwellAtMs = -1;
    starting = false;
    suspendedAt = null;
    deps.walker.cancel();
    deps.onWalkEnd();
    deps.dropSource.release();
  }

  function watchHost(): void {
    const active = stroll;
    if (!active || active.watching || nowMs < active.nextWatchAtMs) return;
    active.nextWatchAtMs = nowMs + PERCH_POLL_MS;
    active.watching = true;
    const startedAt = generation;
    void deps
      .listWindows()
      .then((windows) => {
        if (!alive(startedAt) || stroll !== active) return;
        const host = windows.find(
          (candidate) => candidate.windowNumber === active.host.windowNumber,
        );
        if (!host) {
          loseHost(startedAt);
          return;
        }
        const moved =
          Math.abs(host.x - active.host.x) > MOVE_TH || Math.abs(host.y - active.host.y) > MOVE_TH;
        active.lostStreak = moved ? active.lostStreak + 1 : 0;
        if (active.lostStreak >= PERCH_AMBIGUOUS_LOST_TICKS) loseHost(startedAt);
      })
      .catch((error) => log.warn("host_watch_failed", { degrade: true, error: String(error) }))
      .finally(() => {
        active.watching = false;
      });
  }

  async function strollOnce(): Promise<void> {
    const startedAt = generation;
    const armed = deps.dropSource.armedSit();
    if (armed?.origin !== "commit") return;
    // The same ownership order the floor stroll keeps: ambient yields to everything else.
    if (reducedMotion() || deps.isBusy() || deps.currentMotionKind() !== "ambient") {
      rearmDwell();
      return;
    }
    const anchor = deps.renderer.getCharacterAnchor();
    const probe = deps.renderer.getPerchProbe();
    if (!anchor || !probe) return;
    const win = deps.getWindow();
    const [pos, scaleFactor, windows, monitors] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      deps.listWindows(),
      deps.listMonitors(),
    ]);
    if (!alive(startedAt)) return;
    const host = windows.find((candidate) => candidate.windowNumber === armed.windowNumber);
    if (!host) {
      deps.dropSource.release();
      return;
    }
    const scale = scaleFactor > 0 ? scaleFactor : 1;
    // Standing puts the feet on the host's top edge; a window the work area would clamp
    // off that edge is no surface to walk, so the sit stays.
    const monitor = monitorAt(monitors, pos.x, pos.y);
    const standingY = host.y - anchor.y;
    if (!monitor || standingY < monitor.workArea.position.y / scale) {
      rearmDwell();
      return;
    }
    const plan = planPerchStroll({
      currentX: pos.x / scale + anchor.x,
      winLeft: host.x,
      winRight: host.x + host.width,
      charHpx: probe.charHpx,
      cfg: deps.getConfig(),
      rng,
    });
    if (!plan) {
      rearmDwell();
      return;
    }
    const suspended = deps.dropSource.suspendSit();
    if (!suspended) return;
    suspendedAt = startedAt;
    try {
      if (suspended.origin !== "commit") return;
      await win.setPositionPhysical(pos.x, Math.round(standingY * scale));
      if (!alive(startedAt)) return;
      let accepted = false;
      await deps.walker.walkTo(plan.centerX - anchor.x, () => {
        accepted = true;
        stroll = { host, nextWatchAtMs: nowMs + PERCH_POLL_MS, lostStreak: 0, watching: false };
        deps.onWalkStart();
      });
      if (!alive(startedAt)) return;
      stroll = null;
      if (accepted) deps.onWalkEnd();
      const applied = await win.outerPosition();
      if (!alive(startedAt)) return;
      const edgeLocalYpx = host.y - applied.y / scale;
      suspendedAt = null;
      deps.dropSource.resumeSit(edgeLocalYpx);
      deps.onSit(host, edgeLocalYpx);
      rearmDwell();
    } finally {
      if (alive(startedAt) && stroll) {
        stroll = null;
        deps.walker.cancel();
        deps.onWalkEnd();
      }
      // Anything but a completed re-sit leaves the seat unrecoverable — drop it silently
      // rather than leave the drop source armed on a suspension nobody owns.
      if (suspendedAt === startedAt) abandonSuspension();
    }
  }

  function tick(ctx: { elapsed: number }): void {
    nowMs = ctx.elapsed * 1000;
    if (stroll) {
      watchHost();
      return;
    }
    if (starting) return;
    const sit = deps.dropSource.armedSit();
    if (sit?.origin !== "commit") {
      dwellAtMs = -1;
      return;
    }
    if (dwellAtMs < 0) {
      rearmDwell();
      return;
    }
    if (nowMs < dwellAtMs) return;
    dwellAtMs = -1;
    starting = true;
    const startedAt = generation;
    void strollOnce()
      .catch((error) => log.warn("stroll_failed", { degrade: true, error: String(error) }))
      .finally(() => {
        // A cancelled attempt already handed `starting` to whatever came after it.
        if (generation === startedAt) starting = false;
      });
  }

  return {
    start() {
      if (unsub) return;
      stopped = false;
      dwellAtMs = -1;
      unsub = deps.renderer.onTick(tick);
    },
    cancel,
    stop() {
      stopped = true;
      cancel();
      unsub?.();
      unsub = null;
    },
  };
}
