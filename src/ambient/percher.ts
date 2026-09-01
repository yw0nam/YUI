/**
 * Ambient perched walking — while the character sits on a foreign window she dwells,
 * stands up on the window's top edge, strolls a short way along it, and sits back down.
 *
 * The sit pin is suspended for the length of the walk and restored from wherever the
 * window actually landed, so the loop owns the seat the whole time: it either resumes it
 * or abandons it, and only a lost host takes the published exit path.
 *
 * A stroll with no window to jump across to now and then walks off the host's nearer edge
 * instead and lets the fall take her. The same loop takes the seat at the other end: a
 * fall that comes down on a window top hands it back through landOn().
 */

import type { FallConfig, JumpConfig, PerchWalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import { monitorAt, type ScreenMonitor } from "../io/screen-geometry";
import {
  MOVE_TH,
  PERCH_AMBIGUOUS_LOST_TICKS,
  PERCH_MOTION_ID,
  PERCH_POLL_MS,
  uncoveredSpan,
} from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { TickFn } from "../renderer";
import { type JumpOutcome, type JumpPlan, pickJumpTarget } from "./jumper";
import { prefersReducedMotion } from "./tier1";
import { WALK_YAW_EASE_MS } from "./walker";

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

/**
 * Where a step-off walks to: the nearer end of the walkable stretch, and a width past it.
 * A spot outside the work area is off the screen she is on, where nothing would catch her
 * and no floor is in reach, so that edge is passed over for the other one.
 */
export function planStepOff(opts: {
  currentX: number;
  span: { left: number; right: number };
  /** How far past the edge she walks — the same room a landing surface has to offer. */
  roomPx: number;
  /** Logical x range of the work area she has to come down inside. */
  workArea: { left: number; right: number };
  rng: Rng;
}): { edge: "left" | "right"; toX: number } | null {
  const { currentX, span, roomPx, workArea, rng } = opts;
  if (span.right < span.left) return null;
  const toLeft = currentX - span.left;
  const toRight = span.right - currentX;
  const nearer: "left" | "right" =
    toLeft === toRight ? (rng() < 0.5 ? "left" : "right") : toLeft < toRight ? "left" : "right";
  for (const edge of [nearer, nearer === "left" ? "right" : "left"] as const) {
    const toX = edge === "left" ? span.left - roomPx : span.right + roomPx;
    if (toX >= workArea.left && toX <= workArea.right) return { edge, toX };
  }
  return null;
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
    setBodyYaw(rad: number, easeMs: number): void;
  };
  getWindow(): PercherWindow;
  listWindows(): Promise<WindowRect[]>;
  listMonitors(): Promise<ScreenMonitor[]>;
  getConfig(): PerchWalkConfig;
  getJumpConfig(): JumpConfig;
  /** The fall's knobs — the step-off rolls against them and walks by their landing room. */
  getFallConfig(): FallConfig;
  walker: {
    walkTo(toX: number, onAccepted?: () => void): Promise<"arrived" | "lost">;
    cancel(): void;
  };
  jumper: {
    jump(
      plan: JumpPlan,
      at: { anchor: { x: number; y: number }; charHpx: number; scale: number },
      onTakeoff?: () => void,
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
  /** The jump clip has the body and the old seat is gone — she is committed to the arc. */
  onTakeoff(): void;
  /** She walked off the host's edge on purpose and is standing on nothing. */
  onStepOff(): void;
  rng?: Rng;
  /** Defaults to the OS setting; injected in tests. */
  reducedMotion?: () => boolean;
}

export interface Percher {
  start(): void;
  /**
   * A fall came down on `target` — take the seat there once the body is back on the
   * ambient baseline. Ignored if the target is gone by the time the stack is read.
   */
  landOn(target: WindowRect): void;
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
  /** A walk cue is out and owes its close, whether or not a host is being watched. */
  let walkCueOpen = false;
  /** A window a fall put her on, waiting for the body to come back before it is taken. */
  let landing: WindowRect | null = null;
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

  /** Open the walk cue, once per attempt however many legs it turns out to have. */
  function startWalkCue(): void {
    if (walkCueOpen) return;
    walkCueOpen = true;
    deps.onWalkStart();
  }

  function endWalkCue(): void {
    if (!walkCueOpen) return;
    walkCueOpen = false;
    deps.onWalkEnd();
  }

  /** Close it the interrupted way — the posture and the hit test still need the news. */
  function cancelWalkCue(): void {
    if (!walkCueOpen) return;
    walkCueOpen = false;
    deps.onWalkCancel();
  }

  function rearmDwell(): void {
    dwellAtMs = nowMs + nextPerchDwell(deps.getConfig(), rng);
  }

  /**
   * Whether the body is on a clip this loop may take it from: the perch hold is its own
   * baseline, and every other clip — its own kind included — outranks it.
   */
  function onBaseline(): boolean {
    const motion = deps.currentMotion();
    return motion !== null && (motion.kind === "ambient" || motion.id === PERCH_MOTION_ID);
  }

  function cancel(): void {
    generation++;
    dwellAtMs = -1;
    starting = false;
    landing = null;
    if (stroll) deps.walker.cancel();
    stroll = null;
    deps.jumper.cancel();
    cancelWalkCue();
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
    endWalkCue();
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
   * Cross to the neighbour she has just walked to the edge for. The host is given up on
   * the takeoff beat and not a moment sooner, so a jump that never leaves the ground still
   * has a seat to put back, while one that leaves and loses its target hangs in mid-air
   * for the fall to take.
   */
  async function runJump(
    startedAt: number,
    plan: JumpPlan,
    host: WindowRect,
    anchor: { x: number; y: number },
    charHpx: number,
    scale: number,
    win: PercherWindow,
  ): Promise<JumpOutcome> {
    const target = plan.target;
    const outcome = await deps.jumper.jump(plan, { anchor, charHpx, scale }, () => {
      // Point of no return: the clip has the body and the target is confirmed, so the
      // host goes for good. No exit cue — the seat was not lost, she jumped off it.
      startWalkCue();
      abandonSuspension();
      log.info("jump_start", {
        from: host.windowNumber,
        to: target.windowNumber,
        gap: Math.round(Math.abs(plan.landingX - plan.takeoffX)),
        dy: Math.round(target.y - host.y),
      });
      deps.onTakeoff();
    });
    if (!alive(startedAt)) return "cancelled";
    if (outcome === "refused" || outcome === "cancelled") return outcome;
    if (outcome === "lost") {
      log.info("jump_lost", { windowNumber: target.windowNumber });
      endWalkCue();
      // Nothing else squares her up on the way down, and she fell out of a turn.
      deps.renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
      deps.onTargetLost();
      return outcome;
    }
    await settleOn(startedAt, target, plan.landingX, anchor, charHpx, scale, win, "jump");
    return outcome;
  }

  /**
   * Take the seat on a window top she is already standing on, whether a jump or a fall put
   * her there: a short leg along the uncovered stretch, then the sit read from where the
   * window actually ended up. A target that has gone by the time the stack is read leaves
   * her standing, for the next drag or agent command to move.
   */
  async function settleOn(
    startedAt: number,
    target: WindowRect,
    landingX: number,
    anchor: { x: number; y: number },
    charHpx: number,
    scale: number,
    win: PercherWindow,
    from: "jump" | "fall",
  ): Promise<void> {
    // The stack she planned against is a walk and a flight old by now; a window that has
    // slid over the target's top since then bounds this leg.
    const windows = await deps.listWindows();
    if (!alive(startedAt)) return;
    const targetIndex = windows.findIndex((w) => w.windowNumber === target.windowNumber);
    if (targetIndex < 0) {
      log.info("perch_landing_lost", { windowNumber: target.windowNumber, from });
      // A jump onto a window that has since closed leaves her over the gap she crossed, so
      // the fall takes her the same way a target lost in the air does. A fall has already
      // come down where it came down: she stands there until something else moves her.
      if (from === "jump") {
        endWalkCue();
        deps.renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
        deps.onTargetLost();
      }
      return;
    }
    const span = uncoveredSpan(windows, targetIndex, landingX);
    // A user who asked for no motion gets the seat and none of the walk to it.
    const leg = reducedMotion()
      ? null
      : planPerchStroll({
          currentX: landingX,
          winLeft: span.left,
          winRight: span.right,
          charHpx,
          cfg: deps.getConfig(),
          rng,
        });
    if (leg) {
      // She is standing on the target now, so the last stretch watches that window.
      const walked = await deps.walker.walkTo(leg.centerX - anchor.x, () => {
        startWalkCue();
        stroll = {
          host: target,
          nextWatchAtMs: nowMs + PERCH_POLL_MS,
          lostStreak: 0,
          watching: false,
        };
      });
      if (!alive(startedAt)) return;
      stroll = null;
      // A leg that stopped short still stopped somewhere on the target's top, and the
      // seat is read from where she actually is — so she sits there rather than being
      // left standing with nothing armed and nothing scheduled to move her again.
      if (walked !== "arrived") log.debug("perch_leg_short", { windowNumber: target.windowNumber });
    }
    const applied = await win.outerPosition();
    if (!alive(startedAt)) return;
    const edgeLocalYpx = target.y - applied.y / scale;
    log.info("perch_landed", {
      windowNumber: target.windowNumber,
      x: Math.round(applied.x / scale + anchor.x),
      from,
    });
    // A leg that ran squares her up on its way out, but one that never started or never
    // arrived does not, and she would sit down still side-on from the jump.
    deps.renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
    // The walk ends before the sit lands, so the posture settles on sitting, not standing.
    endWalkCue();
    deps.onSit(target, edgeLocalYpx);
    deps.dropSource.adoptSit(target.windowNumber, { x: target.x, y: target.y }, charHpx, "commit");
    rearmDwell();
  }

  /** Read what the tail needs about the body and the screen, then take the seat. */
  async function runLanding(startedAt: number, target: WindowRect): Promise<void> {
    const anchor = deps.renderer.getCharacterAnchor();
    const probe = deps.renderer.getPerchProbe();
    // A body the renderer cannot project yet leaves the landing where it is, for a later
    // tick to take — dropping it would strand her standing on the window she came down on.
    if (!anchor || !probe) return;
    landing = null;
    const win = deps.getWindow();
    const [pos, scaleFactor] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    if (!alive(startedAt)) return;
    const scale = scaleFactor > 0 ? scaleFactor : 1;
    await settleOn(
      startedAt,
      target,
      pos.x / scale + anchor.x,
      anchor,
      probe.charHpx,
      scale,
      win,
      "fall",
    );
  }

  async function strollOnce(): Promise<void> {
    const startedAt = generation;
    const armed = deps.dropSource.armedSit();
    if (armed?.origin !== "commit") return;
    // The same ownership order the floor stroll keeps, except that the perch hold is this
    // loop's own baseline: it holds the body for as long as the sit lasts, so waiting for it
    // to end would mean never strolling.
    if (reducedMotion() || deps.isBusy() || !onBaseline()) {
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
    // off that edge is no surface to walk, so the sit stays. The screen is the one the feet
    // are on — a window straddling a screen edge has its origin off every monitor.
    const monitor = monitorAt(monitors, pos.x + anchor.x * scale, pos.y + anchor.y * scale);
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
            currentX: fromX,
            charHpx: probe.charHpx,
            charWpx,
            perchCfg: cfg,
            jumpCfg,
            minStandingTop: monitor.workArea.position.y / scale + anchor.y,
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
    // Nowhere to cross to is what makes stepping off the edge the interesting way out,
    // narrow ledges included. The roll comes last so a stroll draws the same either way.
    const fallCfg = deps.getFallConfig();
    const stepOff =
      neighbour === null && charWpx !== null && rng() < fallCfg.step_off_probability
        ? planStepOff({
            currentX: fromX,
            span,
            roomPx: fallCfg.land_room_frac * charWpx,
            workArea: {
              left: monitor.workArea.position.x / scale,
              right: (monitor.workArea.position.x + monitor.workArea.size.width) / scale,
            },
            rng,
          })
        : null;
    if (!jumpTo && !stepOff && !plan) {
      log.debug("stroll_skipped", { reason: "no_room" });
      rearmDwell();
      return;
    }
    const toX = jumpTo ? jumpTo.takeoffX : (stepOff?.toX ?? plan?.centerX ?? fromX);
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
        startWalkCue();
        stroll = { host, nextWatchAtMs: nowMs + PERCH_POLL_MS, lostStreak: 0, watching: false };
        if (stepOff) {
          log.info("step_off_start", {
            windowNumber: host.windowNumber,
            edge: stepOff.edge,
            toX: Math.round(toX),
          });
          return;
        }
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
      });
      if (!alive(startedAt)) return;
      stroll = null;
      // Her feet are past the host's edge now, so the fall the drop starts finds the next
      // surface below rather than the window she just left. No exit cue: she left on
      // purpose, and no clip of her own — the fall's own posture takes it from here.
      if (stepOff && walked === "arrived") {
        abandonSuspension();
        endWalkCue();
        deps.onStepOff();
        return;
      }
      // Arriving is the whole question: a walk resolves "arrived" without accepting when
      // she already stands on the spot, and a jump from there still owes a walk cue —
      // which the takeoff opens, so a jump that never leaves owes nothing.
      if (jumpTo && walked === "arrived") {
        // Only a refusal leaves her still on the host, with the seat to put back.
        if (
          (await runJump(startedAt, jumpTo, host, anchor, probe.charHpx, scale, win)) !== "refused"
        ) {
          return;
        }
        if (!alive(startedAt)) return;
        // The jump turned her toward a neighbour she is not going to after all; square
        // her up before she sits back down on the host.
        deps.renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
      }
      endWalkCue();
      if (!accepted) log.debug("stroll_skipped", { reason: "not_accepted" });
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
        endWalkCue();
      }
      // Anything but a completed re-sit leaves the seat unrecoverable — drop it silently
      // rather than leave the drop source armed on a suspension nobody owns.
      if (suspendedAt === startedAt) abandonSuspension();
    }
  }

  /** Take a pending landing the moment the touchdown clip hands the body back. */
  function beginLanding(target: WindowRect): void {
    if (!onBaseline()) return;
    starting = true;
    const startedAt = generation;
    void runLanding(startedAt, target)
      .catch((error) => log.warn("landing_failed", { degrade: true, error: String(error) }))
      .finally(() => {
        if (generation === startedAt) starting = false;
      });
  }

  function tick(ctx: { elapsed: number }): void {
    nowMs = ctx.elapsed * 1000;
    if (stroll) {
      watchHost();
      return;
    }
    if (starting) return;
    if (landing) {
      beginLanding(landing);
      return;
    }
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
    landOn(target) {
      if (stopped) return;
      landing = target;
      dwellAtMs = -1;
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
