/**
 * Ambient perched walking — while the character sits on a foreign window she dwells,
 * stands up on the window's top edge, strolls a short way along it, and sits back down.
 *
 * The sit pin is suspended for the length of the walk and restored from wherever the
 * window actually landed, so the loop owns the seat the whole time: it either resumes it
 * or abandons it, and only a lost host takes the published exit path.
 */

import type { JumpConfig, PerchWalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import { monitorAt, type ScreenMonitor } from "../io/screen-geometry";
import {
  containsSeat,
  MOVE_TH,
  PERCH_AMBIGUOUS_LOST_TICKS,
  PERCH_MOTION_ID,
  PERCH_POLL_MS,
} from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { TickFn } from "../renderer";
import { type JumpOutcome, type JumpPlan, pickJumpTarget } from "./jumper";
import { prefersReducedMotion } from "./tier1";

const log = createLogger("percher");

type Rng = () => number;

export function nextPerchDwell(cfg: PerchWalkConfig, rng: Rng = Math.random): number {
  return cfg.dwell_min_ms + (cfg.dwell_max_ms - cfg.dwell_min_ms) * rng();
}

/**
 * The stretch of the host's top edge reachable from `currentX`, in the z-ordered
 * front-to-back window list the perch poll reads. A window in front of the host that
 * reaches that edge detaches the perch the moment the seat lands under it, so it bounds
 * the walk on whichever side of the seat it lies. A window straddling `currentX` leaves
 * left past right — the seat is boxed in and there is nothing to walk.
 */
export function uncoveredSpan(
  windows: WindowRect[],
  hostIndex: number,
  currentX: number,
): { left: number; right: number } {
  const host = windows[hostIndex];
  let left = host.x;
  let right = host.x + host.width;
  for (let i = 0; i < hostIndex; i++) {
    const w = windows[i];
    // Its own left edge on the host's edge line asks the one question left: whether this
    // window reaches that line at all.
    if (!containsSeat(w, { x: w.x, y: host.y })) continue;
    if (w.x + w.width > currentX) right = Math.min(right, w.x);
    if (w.x < currentX) left = Math.max(left, w.x + w.width);
  }
  return { left, right };
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

export interface PercherWindow {
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
    /** How wide she stands on screen — the gap a jump may clear is measured in it. */
    getCharacterWidthPx(): number | null;
  };
  getWindow(): PercherWindow;
  listWindows(): Promise<WindowRect[]>;
  listMonitors(): Promise<ScreenMonitor[]>;
  getConfig(): PerchWalkConfig;
  getJumpConfig(): JumpConfig;
  walker: {
    walkTo(toX: number, onAccepted?: () => void): Promise<"arrived" | "lost">;
    cancel(): void;
  };
  jumper: {
    jump(
      plan: JumpPlan,
      at: { anchor: { x: number; y: number }; charHpx: number; scale: number },
    ): Promise<JumpOutcome>;
    cancel(): void;
  };
  dropSource: {
    armedSit(): { windowNumber: number; origin: "commit" | "adopt" } | null;
    suspendSit(): SuspendedSit | null;
    resumeSit(edgeLocalYpx: number): void;
    abandonSit(): void;
    adoptSit(
      windowNumber: number,
      rect: { x: number; y: number },
      charHpx: number,
      origin: "commit" | "adopt",
    ): void;
    release(): void;
  };
  /** The committed motion and its registry kind. null when nothing is playing. */
  currentMotion(): { id: string; kind: MotionKind | null } | null;
  /** A turn is in flight or speech is still playing. */
  isBusy(): boolean;
  onWalkStart(): void;
  onWalkEnd(): void;
  onWalkCancel(): void;
  onSit(target: WindowRect, edgeLocalYpx: number): void;
  /** The host went away — the character is left standing on nothing. */
  onHostLost(): void;
  /** A jump lost the window it was aimed at — the character is left in mid-air. */
  onTargetLost(): void;
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
    deps.jumper.cancel();
    abandonSuspension();
  }

  function loseHost(startedAt: number): void {
    if (!alive(startedAt) || !stroll) return;
    log.info("host_lost", { windowNumber: stroll.host.windowNumber });
    generation++;
    stroll = null;
    dwellAtMs = -1;
    starting = false;
    suspendedAt = null;
    deps.walker.cancel();
    deps.onWalkEnd();
    deps.dropSource.release();
    deps.onHostLost();
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

  /**
   * Cross to the neighbour she has just walked to the edge for. The host is left for good
   * before takeoff — no exit cue, because the seat was not lost, she jumped off it — so a
   * flight that never arrives leaves her in mid-air for the fall to take.
   */
  async function runJump(
    startedAt: number,
    plan: JumpPlan,
    host: WindowRect,
    anchor: { x: number; y: number },
    charHpx: number,
    scale: number,
    win: PercherWindow,
    windows: WindowRect[],
  ): Promise<void> {
    stroll = null;
    abandonSuspension();
    const target = plan.target;
    log.info("jump_start", {
      from: host.windowNumber,
      to: target.windowNumber,
      gap: Math.round(Math.abs(plan.landingX - plan.takeoffX)),
      dy: Math.round(target.y - host.y),
    });
    const outcome = await deps.jumper.jump(plan, { anchor, charHpx, scale });
    if (!alive(startedAt) || outcome === "cancelled") return;
    if (outcome === "lost") {
      log.info("jump_lost", { windowNumber: target.windowNumber });
      deps.onWalkEnd();
      deps.onTargetLost();
      return;
    }
    // She is standing on the target now, so the rest of the stroll runs on its top edge.
    stroll = { host: target, nextWatchAtMs: nowMs + PERCH_POLL_MS, lostStreak: 0, watching: false };
    const targetIndex = windows.findIndex((w) => w.windowNumber === target.windowNumber);
    const span = uncoveredSpan(windows, targetIndex, plan.landingX);
    const leg = planPerchStroll({
      currentX: plan.landingX,
      winLeft: span.left,
      winRight: span.right,
      charHpx,
      cfg: deps.getConfig(),
      rng,
    });
    if (leg) await deps.walker.walkTo(leg.centerX - anchor.x);
    if (!alive(startedAt)) return;
    stroll = null;
    const applied = await win.outerPosition();
    if (!alive(startedAt)) return;
    const edgeLocalYpx = target.y - applied.y / scale;
    log.info("jump_landed", {
      windowNumber: target.windowNumber,
      x: Math.round(applied.x / scale + anchor.x),
    });
    deps.onSit(target, edgeLocalYpx);
    deps.dropSource.adoptSit(target.windowNumber, { x: target.x, y: target.y }, charHpx, "commit");
    deps.onWalkEnd();
    rearmDwell();
  }

  async function strollOnce(): Promise<void> {
    const startedAt = generation;
    const armed = deps.dropSource.armedSit();
    if (armed?.origin !== "commit") return;
    // The same ownership order the floor stroll keeps, except that the perch hold is this
    // loop's own baseline: it holds the body for as long as the sit lasts, so waiting for it
    // to end would mean never strolling. Every other clip, its own kind included, still wins.
    const motion = deps.currentMotion();
    const baseline =
      motion !== null && (motion.kind === "ambient" || motion.id === PERCH_MOTION_ID);
    if (reducedMotion() || deps.isBusy() || !baseline) {
      log.debug("stroll_skipped", { reason: "gated" });
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
    const hostIndex = windows.findIndex(
      (candidate) => candidate.windowNumber === armed.windowNumber,
    );
    const host = windows[hostIndex];
    if (!host) {
      deps.dropSource.release();
      deps.onHostLost();
      return;
    }
    const scale = scaleFactor > 0 ? scaleFactor : 1;
    // Standing puts the feet on the host's top edge; a window the work area would clamp
    // off that edge is no surface to walk, so the sit stays.
    const monitor = monitorAt(monitors, pos.x, pos.y);
    const standingY = host.y - anchor.y;
    if (!monitor || standingY < monitor.workArea.position.y / scale) {
      log.debug("stroll_skipped", { reason: "work_area" });
      rearmDwell();
      return;
    }
    const fromX = pos.x / scale + anchor.x;
    const span = uncoveredSpan(windows, hostIndex, fromX);
    const cfg = deps.getConfig();
    const charWpx = deps.renderer.getCharacterWidthPx();
    // A neighbour she could cross to turns the stroll into a walk to the host's edge on
    // that side, now and then. Rolling only once one exists keeps the draw meaningful.
    const jumpCfg = deps.getJumpConfig();
    const neighbour =
      charWpx === null
        ? null
        : pickJumpTarget({
            windows,
            hostIndex,
            span,
            charHpx: probe.charHpx,
            charWpx,
            margin: cfg.edge_margin_frac * probe.charHpx,
            cfg: jumpCfg,
          });
    const jumpTo = neighbour !== null && rng() < jumpCfg.probability ? neighbour : null;
    const plan = jumpTo
      ? null
      : planPerchStroll({
          currentX: fromX,
          winLeft: span.left,
          winRight: span.right,
          charHpx: probe.charHpx,
          cfg,
          rng,
        });
    if (!jumpTo && !plan) {
      log.debug("stroll_skipped", { reason: "no_room" });
      rearmDwell();
      return;
    }
    const toX = jumpTo ? jumpTo.takeoffX : (plan?.centerX ?? fromX);
    const suspended = deps.dropSource.suspendSit();
    if (!suspended) return;
    suspendedAt = startedAt;
    try {
      if (suspended.origin !== "commit") return;
      await win.setPositionPhysical(pos.x, Math.round(standingY * scale));
      if (!alive(startedAt)) return;
      // Where the window manager actually put the window, which is what decides whether the
      // feet ended up on the edge or somewhere down the window's face.
      const stood = await win.outerPosition();
      if (!alive(startedAt)) return;
      let accepted = false;
      const walked = await deps.walker.walkTo(toX - anchor.x, () => {
        accepted = true;
        stroll = { host, nextWatchAtMs: nowMs + PERCH_POLL_MS, lostStreak: 0, watching: false };
        log.info("stroll_start", {
          windowNumber: host.windowNumber,
          fromX: Math.round(fromX),
          toX: Math.round(toX),
          direction: plan?.direction ?? (toX >= fromX ? 1 : -1),
          hostTop: host.y,
          anchorY: anchor.y,
          standingY: Math.round(standingY),
          windowY: Math.round(stood.y / scale),
          scale,
        });
        deps.onWalkStart();
      });
      if (!alive(startedAt)) return;
      // A walk that never started or never arrived leaves nothing to jump from; the sit
      // simply comes back the way a skipped stroll's does.
      if (jumpTo && accepted && walked === "arrived") {
        await runJump(startedAt, jumpTo, host, anchor, probe.charHpx, scale, win, windows);
        return;
      }
      stroll = null;
      if (accepted) deps.onWalkEnd();
      else log.debug("stroll_skipped", { reason: "not_accepted" });
      const applied = await win.outerPosition();
      if (!alive(startedAt)) return;
      const edgeLocalYpx = host.y - applied.y / scale;
      suspendedAt = null;
      deps.dropSource.resumeSit(edgeLocalYpx);
      log.info("resit", {
        windowNumber: host.windowNumber,
        x: Math.round(applied.x / scale + anchor.x),
        edgeLocalYpx: Math.round(edgeLocalYpx),
        windowY: Math.round(applied.y / scale),
      });
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
