/**
 * Climbing — the character occasionally scales a foreign window, sits on its top edge
 * for a while, then climbs back down.
 *
 * Presentation only, no judgment: the climb is a client-scheduled ambient cue and the
 * backend only ever sees the posture it produces. The VRM stays at scene origin playing
 * the in-place climb clips while a per-frame loop translates the OS window along the
 * chosen wall; speeds come from each clip's own displacement through the renderer's
 * world↔px projection, so the hands never slide at any window size or scale factor.
 *
 * A climb is: walk to the wall → face it → `climb_up` up the wall → `climb_up_done`
 * over the ledge → sit. A climb-origin sit later descends by releasing the perch, walking
 * to the nearer edge, facing the wall, and playing `climb_down` then
 * `climb_down_landing`. A window whose bottom hangs above the floor hands the last stretch
 * to the faller.
 *
 * Ownership is user > agent > ambient, but only a pickup or an agent move cancels: an
 * express clip taking the body holds the window where it is and the climb clip is
 * reclaimed once the ambient baseline returns. The target window is re-checked while the
 * sequence runs; losing it drops the character rather than stranding her on a wall.
 *
 * Pure planning/geometry lives in the exported functions; createClimber owns the two
 * timers, the async window reads, and the per-frame translation.
 */

import type { ClimbConfig, WalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import { floorPx, monitorAt, type PetWindow, type ScreenMonitor } from "../io/screen-geometry";
import { MOVE_TH } from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { createLegRunner } from "./clip-leg";
import { type Rng, randRange } from "./cues";
import type { Sitter } from "./sitter";
import { prefersReducedMotion } from "./tier1";
import { canStartStroll, MAX_STEP_DT_S, onFloor, WALK_MOTION_ID, type WalkerDoc } from "./walker";

const log = createLogger("climber");

/** Registry id of the looping wall ascent. */
export const CLIMB_UP_MOTION_ID = "climb_up";
/** Registry id of the ledge pull-over that ends an ascent. */
export const CLIMB_UP_DONE_MOTION_ID = "climb_up_done";
/** Registry id of the looping wall descent. */
export const CLIMB_DOWN_MOTION_ID = "climb_down";
/** Registry id of the touchdown that ends a descent. */
export const CLIMB_DOWN_LANDING_MOTION_ID = "climb_down_landing";

/** Root yaw (rad) toward the wall — a quarter turn off camera-facing. */
export const CLIMB_YAW_RAD = Math.PI / 2;
/** Yaw ease (ms), run concurrently with the motion crossfade at both ends of a climb. */
export const CLIMB_YAW_EASE_MS = 400;
/** How long the character takes to drop off the ledge onto the wall (ms). */
export const HANG_MS = 400;
/**
 * How long before the pull-over clip ends the ledge walk takes the body. The walk
 * crossfades out of the clip's settled last stretch; a oneshot left to run out drops
 * the body through idle first.
 */
export const PULL_HANDOFF_S = 0.5;
/** Cadence (ms) of the target re-check while a sequence runs. */
export const TARGET_WATCH_MS = 700;
/** Cadence (ms) of the diagnostic geometry sample while a leg runs. */
export const GEOMETRY_LOG_MS = 500;
/** How long a descent waits for the released perch to clear before giving up (ms). */
export const RELEASE_WAIT_MS = 1000;

/** The wall a climb runs on: which window, which side, and the span it covers. */
export interface ClimbTarget {
  windowNumber: number;
  side: "left" | "right";
  /** Global x (logical px) of the climbed edge. */
  edgeX: number;
  topY: number;
  bottomY: number;
  /** Window width — how much ledge there is to walk in along before sitting. */
  width: number;
  /** Window origin at pick time — the poll's move baseline. */
  rect: { x: number; y: number };
  app: string | null;
  title: string | null;
}

/** An axis-aligned rect in the same global logical px as the window list. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function containsPoint(a: Box, p: { x: number; y: number }): boolean {
  return p.x >= a.x && p.x <= a.x + a.width && p.y >= a.y && p.y <= a.y + a.height;
}

/**
 * The column the character occupies on the wall: outside the window's face, from the
 * edge out past where she stands. It has to stay clear of anything in front of the target.
 */
function wallColumn(
  edgeX: number,
  topY: number,
  floor: number,
  wallOffset: number,
  side: "left" | "right",
): Box {
  const width = wallOffset * 2;
  return {
    x: side === "left" ? edgeX - width : edgeX,
    y: topY,
    width,
    height: Math.max(floor - topY, 0),
  };
}

/**
 * Whether the column she would occupy on this wall fits on the screen. She stands
 * outside the window's face, so a window against the side of the monitor has a wall
 * with no floor to stand on — climbing it walks her off the screen.
 */
function columnOnMonitor(column: Box, monitor: Box): boolean {
  return column.x >= monitor.x && column.x + column.width <= monitor.x + monitor.width;
}

/**
 * Where the feet stand to climb an edge: a hand's reach outside the window's face, so
 * the body clears the edge and the hands land on it instead of inside the window.
 */
export function wallStandX(edgeX: number, side: "left" | "right", wallOffset: number): number {
  return side === "left" ? edgeX - wallOffset : edgeX + wallOffset;
}

/**
 * Where the feet sit on the ledge: `walkIn` in from the climbed edge, clamped so the
 * seat stays on the window — a sit clip parked on the corner hangs half the body over
 * the edge. On a window narrower than the character, the middle is the best there is.
 */
export function ledgeSeatX(
  edgeX: number,
  side: "left" | "right",
  winW: number,
  charHpx: number,
  walkIn: number,
): number {
  const room = Math.min(walkIn, Math.max(winW - 0.5 * charHpx, winW / 2));
  return side === "left" ? edgeX + room : edgeX - room;
}

/** The corner the character ends up sitting on, just inside the climbed edge. */
function cornerSeat(
  edgeX: number,
  topY: number,
  side: "left" | "right",
  wallOffset: number,
): { x: number; y: number } {
  return { x: edgeX + (side === "left" ? 1 : -1) * 0.5 * wallOffset, y: topY };
}

/**
 * One reading of where the body actually is against the wall it is climbing. Every
 * coordinate is global logical px, rounded; the `_dx` fields measure each point against
 * the climbed edge with **inside the window positive**, on both sides, so a left wall and
 * a right wall read the same way. Diagnostic only — nothing decides anything from it.
 */
export interface ClimbGeometrySample {
  phase: string;
  side: "left" | "right";
  edgeX: number;
  topY: number;
  winX: number;
  winY: number;
  feetX: number;
  feetY: number;
  handLX: number;
  handLY: number;
  handRX: number;
  handRY: number;
  charHpx: number;
  handL_dx: number;
  handR_dx: number;
  feet_dx: number;
  /** Hips projection y, global — shows the clip's own rise against the window's. */
  hipsY: number;
  /** Clip-local playhead (s) the window is following. null when nothing is playing. */
  clipT: number | null;
}

export function climbGeometrySample(args: {
  phase: string;
  side: "left" | "right";
  edgeX: number;
  topY: number;
  /** Pet window origin, global logical px. */
  win: { x: number; y: number };
  /** Feet anchor in pet-window logical px. */
  feet: { x: number; y: number };
  /** Hand anchors in pet-window logical px. */
  hands: { left: { x: number; y: number }; right: { x: number; y: number } };
  /** Hips anchor y in pet-window logical px. */
  hipsY: number;
  /** Clip-local playhead (s), or null when nothing is playing. */
  clipT: number | null;
  charHpx: number;
}): ClimbGeometrySample {
  const { phase, side, edgeX, topY, win, feet, hands, hipsY, clipT, charHpx } = args;
  const r = Math.round;
  const feetX = win.x + feet.x;
  const handLX = win.x + hands.left.x;
  const handRX = win.x + hands.right.x;
  const inside = (x: number): number => r(side === "left" ? x - edgeX : edgeX - x);
  return {
    phase,
    side,
    edgeX: r(edgeX),
    topY: r(topY),
    winX: r(win.x),
    winY: r(win.y),
    feetX: r(feetX),
    feetY: r(win.y + feet.y),
    handLX: r(handLX),
    handLY: r(win.y + hands.left.y),
    handRX: r(handRX),
    handRY: r(win.y + hands.right.y),
    charHpx: r(charHpx),
    handL_dx: inside(handLX),
    handR_dx: inside(handRX),
    feet_dx: inside(feetX),
    hipsY: r(win.y + hipsY),
    clipT,
  };
}

/** Delay (ms) until the next climb attempt. */
export function nextClimbDelay(cfg: ClimbConfig, rng: Rng = Math.random): number {
  return randRange(cfg.interval_min_ms, cfg.interval_max_ms, rng);
}

/** How long (ms) the character stays seated before climbing back down. */
export function nextDwell(cfg: ClimbConfig, rng: Rng = Math.random): number {
  return randRange(cfg.perch_dwell_min_ms, cfg.perch_dwell_max_ms, rng);
}

/**
 * The wall to climb: the side edge nearest the feet, on the nearest window that is
 * reachable, the right size, standing-room-topped, unobstructed and on this monitor.
 * All arguments and results are global logical px. null when nothing qualifies.
 */
export function pickClimbTarget(args: {
  /** Front-to-back, topmost first. */
  windows: WindowRect[];
  feetX: number;
  floor: number;
  workTop: number;
  charHpx: number;
  /** Feet offset inside the pet window — the top edge has to clear the work area by it. */
  anchorY: number;
  /** Bounds of the monitor the pet window sits on. */
  monitor: Box;
  cfg: ClimbConfig;
  /** Longest approach walk, borrowed from the stroll's own reach. */
  maxWalkPx: number;
}): ClimbTarget | null {
  const { windows, feetX, floor, workTop, charHpx, anchorY, monitor, cfg, maxWalkPx } = args;
  const wallOffset = cfg.wall_offset_frac * charHpx;
  const descentOffset = cfg.descent_wall_offset_frac * charHpx;
  let best: { target: ClimbTarget; distance: number } | null = null;

  for (const [index, win] of windows.entries()) {
    const topY = win.y;
    const bottomY = win.y + win.height;
    if (bottomY < floor - charHpx) continue;
    if (win.height < 0.5 * charHpx) continue;
    if (win.height > cfg.max_height_frac * charHpx) continue;
    // The OS clamps the pet window to the work-area top, so a ledge it cannot reach
    // would leave the feet hanging below the edge.
    if (topY - anchorY < workTop) continue;
    const front = windows.slice(0, index);
    const sides: Array<{ side: "left" | "right"; edgeX: number }> = [
      { side: "left", edgeX: win.x },
      { side: "right", edgeX: win.x + win.width },
    ];
    sides.sort((a, b) => Math.abs(a.edgeX - feetX) - Math.abs(b.edgeX - feetX));
    for (const { side, edgeX } of sides) {
      const distance = Math.abs(edgeX - feetX);
      if (distance > maxWalkPx) continue;
      if (best && distance >= best.distance) continue;
      if (!containsPoint(monitor, { x: edgeX, y: topY })) continue;
      const column = wallColumn(edgeX, topY, floor, wallOffset, side);
      if (!columnOnMonitor(column, monitor)) continue;
      // The descent stands further out: a wall she could not come down is not worth going up.
      if (!columnOnMonitor(wallColumn(edgeX, topY, floor, descentOffset, side), monitor)) continue;
      if (front.some((w) => overlaps(w, column))) continue;
      if (front.some((w) => containsPoint(w, cornerSeat(edgeX, topY, side, wallOffset)))) continue;
      best = {
        distance,
        target: {
          windowNumber: win.windowNumber,
          side,
          edgeX,
          topY,
          bottomY,
          width: win.width,
          rect: { x: win.x, y: win.y },
          app: win.ownerName,
          title: win.name,
        },
      };
      break;
    }
  }
  return best?.target ?? null;
}

/**
 * The wall to climb down from a sit: the window the perch is armed on, and its nearest
 * side edge whose wall column fits on the monitor and is clear, along with its corner
 * seat, of anything in front of it. The sit pose dangles the feet below the ledge, so
 * the window is found by identity, not by where the feet happen to hang. null when the
 * window is gone or neither wall can be stood on.
 */
export function pickDescentTarget(args: {
  windows: WindowRect[];
  windowNumber: number;
  feetX: number;
  floor: number;
  charHpx: number;
  /** Bounds of the monitor the pet window sits on. */
  monitor: Box;
  cfg: ClimbConfig;
}): ClimbTarget | null {
  const { windows, windowNumber, feetX, floor, charHpx, monitor, cfg } = args;
  const index = windows.findIndex((w) => w.windowNumber === windowNumber);
  if (index < 0) return null;
  const win = windows[index];
  const front = windows.slice(0, index);
  const wallOffset = cfg.descent_wall_offset_frac * charHpx;
  const sides: Array<{ side: "left" | "right"; edgeX: number }> = [
    { side: "left", edgeX: win.x },
    { side: "right", edgeX: win.x + win.width },
  ];
  sides.sort((a, b) => Math.abs(a.edgeX - feetX) - Math.abs(b.edgeX - feetX));
  for (const { side, edgeX } of sides) {
    const column = wallColumn(edgeX, win.y, floor, wallOffset, side);
    if (!columnOnMonitor(column, monitor)) continue;
    if (front.some((w) => overlaps(w, column))) continue;
    if (front.some((w) => containsPoint(w, cornerSeat(edgeX, win.y, side, wallOffset)))) continue;
    return {
      windowNumber: win.windowNumber,
      side,
      edgeX,
      topY: win.y,
      bottomY: win.y + win.height,
      width: win.width,
      rect: { x: win.x, y: win.y },
      app: win.ownerName,
      title: win.name,
    };
  }
  return null;
}

/** Whether the wall vanished, slid away, or was covered while the character was on it. */
export function climbTargetLost(args: {
  windows: WindowRect[];
  target: ClimbTarget;
  charHpx: number;
  floor: number;
  cfg: ClimbConfig;
  direction: "up" | "down";
}): boolean {
  const { windows, target, charHpx, floor, cfg, direction } = args;
  const index = windows.findIndex((w) => w.windowNumber === target.windowNumber);
  if (index < 0) return true;
  const win = windows[index];
  if (Math.abs(win.x - target.rect.x) > MOVE_TH || Math.abs(win.y - target.rect.y) > MOVE_TH) {
    return true;
  }
  const wallOffset =
    (direction === "down" ? cfg.descent_wall_offset_frac : cfg.wall_offset_frac) * charHpx;
  const front = windows.slice(0, index);
  const column = wallColumn(target.edgeX, target.topY, floor, wallOffset, target.side);
  const seat = cornerSeat(target.edgeX, target.topY, target.side, wallOffset);
  return front.some((w) => overlaps(w, column) || containsPoint(w, seat));
}

export interface ClimberDeps {
  renderer: Pick<
    Renderer,
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "setBodyYaw"
    | "getPxPerMetre"
    | "getMotionDuration"
    | "getMotionTravelY"
    | "getMotionTravelAt"
    | "getCurrentMotionTime"
    | "preloadMotion"
    | "getCharacterAnchor"
    | "getHandAnchors"
    | "getTapPoints"
    | "getPerchProbe"
    | "isPerched"
  >;
  getWindow(): PetWindow;
  listMonitors(): Promise<ScreenMonitor[]>;
  /** Foreign windows, front-to-back. */
  listWindows(): Promise<WindowRect[]>;
  getConfig(): ClimbConfig;
  /** The stroll's knobs — the approach reuses its floor tolerance and its reach. */
  getWalkConfig(): WalkConfig;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
  isPeeking(): boolean;
  isDragging(): boolean;
  /** A turn is in flight or speech is still playing. */
  isBusy(): boolean;
  walker: {
    walkTo(toX: number, onAccepted?: () => void, holdClip?: boolean): Promise<"arrived" | "lost">;
    cancel(): void;
  };
  faller: { drop(): void | Promise<void> };
  /** The seat transitions: the sit onto the ledge, and the stand off it before a descent. */
  sitter: Pick<Sitter, "sitDown" | "standUp" | "cancel">;
  dropSource: {
    adoptSit(
      windowNumber: number,
      rect: { x: number; y: number },
      charHpx: number,
      origin: "commit" | "adopt",
    ): void;
    /** The window an armed sit is held on — which wall a descent belongs to. */
    armedSit(): { windowNumber: number; origin: "commit" | "adopt" } | null;
    release(): void;
  };
  /** A climb began — posture goes climbing and the hit test follows the moving window. */
  onStart(direction: "up" | "down", target: ClimbTarget): void;
  /** The ascent reached the ledge — the character sits on the given window-local edge. */
  onSit(target: ClimbTarget, edgeLocalYpx: number): void;
  /** The climb finished, was cancelled, or lost its wall. */
  onEnd(direction: "up" | "down"): void;
  rng?: Rng;
  /** Defaults to the OS setting; injected in tests. */
  reducedMotion?: () => boolean;
  /** Defaults to the global document; injected in tests. */
  doc?: WalkerDoc;
}

export interface Climber {
  /** Register the frame hook and arm the first interval. */
  start(): void;
  /** End a running climb now, leaving the character where she hangs. */
  cancel(): void;
  /** Off takes her off the wall and stops scheduling; on starts scheduling again. */
  setEnabled(enabled: boolean): void;
  stop(): void;
}

const CLIMB_MOTION_IDS = new Set([
  CLIMB_UP_MOTION_ID,
  CLIMB_UP_DONE_MOTION_ID,
  CLIMB_DOWN_MOTION_ID,
  CLIMB_DOWN_LANDING_MOTION_ID,
]);

/** The wall clips, which hold the body until something takes it back. */
const LOOPING_MOTION_IDS = new Set([CLIMB_UP_MOTION_ID, CLIMB_DOWN_MOTION_ID]);

export function createClimber(deps: ClimberDeps): Climber {
  const { renderer } = deps;
  const rng = deps.rng ?? Math.random;
  const reducedMotion = deps.reducedMotion ?? prefersReducedMotion;
  const doc = deps.doc ?? (typeof document === "undefined" ? null : document);

  let unsub: (() => void) | null = null;
  let stopped = true;
  /** Bumped by every cancel/stop so an in-flight sequence drops its plan. */
  let generation = 0;
  /** A sequence is between onStart and onEnd. */
  let running = false;
  let direction: "up" | "down" | null = null;
  let target: ClimbTarget | null = null;
  /** Character height and floor line the running sequence was planned against. */
  let charHpx = 0;
  let floorY = 0;
  /** Frame-clock deadlines (ms); negative = needs arming. */
  let nextUpAtMs = -1;
  let dwellAtMs = -1;
  let nextWatchAtMs = -1;
  let nextGeoAtMs = -1;
  let watching = false;
  /** The wall the running sequence measures itself against. */
  let geo: { side: "left" | "right"; edgeX: number; topY: number; scale: number } | null = null;
  let nowMs = 0;
  /** The window legs, each paced by its wall clip. */
  const legs = createLegRunner({ renderer, currentMotionKind: deps.currentMotionKind });
  /** A descent waiting for the perch it released to actually clear. */
  let releaseWait: { until: number; settle: (cleared: boolean) => void } | null = null;

  function alive(startedAt: number): boolean {
    return !stopped && generation === startedAt;
  }

  /** End the sequence where it stands. Idempotent — a cancel and its unwind share it. */
  function endClimb(): void {
    if (!direction) return;
    const dir = direction;
    direction = null;
    target = null;
    geo = null;
    // A looping wall clip never ends by itself, and some exits play nothing after it —
    // the faller's silent snap, a drop the hang covered whole. Hand the body back, and
    // leave a finishing oneshot to return to the baseline on its own.
    const current = renderer.getCurrentMotion();
    if (current && LOOPING_MOTION_IDS.has(current.id)) renderer.playMotion(null);
    renderer.setBodyYaw(0, CLIMB_YAW_EASE_MS);
    deps.onEnd(dir);
  }

  function settleReleaseWait(cleared: boolean): void {
    const w = releaseWait;
    if (!w) return;
    releaseWait = null;
    w.settle(cleared);
  }

  /**
   * A held perch drops every non-state clip, so a descent cannot walk until the exit it
   * pushed has come back around through the dispatcher.
   */
  function awaitRelease(): Promise<boolean> {
    if (!renderer.isPerched()) return Promise.resolve(true);
    return new Promise((settle) => {
      releaseWait = { until: nowMs + RELEASE_WAIT_MS, settle };
    });
  }

  function cancel(): void {
    generation += 1;
    nextUpAtMs = -1;
    dwellAtMs = -1;
    legs.finish("lost");
    deps.sitter.cancel();
    settleReleaseWait(false);
    const current = renderer.getCurrentMotion();
    if (current && (CLIMB_MOTION_IDS.has(current.id) || current.id === WALK_MOTION_ID)) {
      renderer.playMotion(null);
    }
    deps.walker.cancel();
    endClimb();
  }

  // The renderer parks its rAF while hidden, so a climb left running would strand her
  // on the wall — take her off it the same way a lost target does.
  const onVisibilityChange = (): void => {
    if (doc?.visibilityState !== "hidden") return;
    const onWall = direction !== null;
    cancel();
    if (onWall) void deps.faller.drop();
  };

  /** Everything both sequences read at plan time, or null when the world is not ready. */
  async function survey(startedAt: number): Promise<{
    win: PetWindow;
    scale: number;
    floor: number;
    workTop: number;
    feetX: number;
    feetY: number;
    /** Feet offset inside the pet window (logical px) — inverts a wall edge into a window origin. */
    anchorX: number;
    anchorY: number;
    charHpx: number;
    pxPerMetre: number;
    /** The monitor the pet window sits on, in logical px — what the pickers measure walls against. */
    bounds: Box;
    windows: WindowRect[];
  } | null> {
    const anchor = renderer.getCharacterAnchor();
    const probe = renderer.getPerchProbe();
    const pxPerMetre = renderer.getPxPerMetre();
    const win = deps.getWindow();
    const [pos, sf, monitors, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      deps.listMonitors(),
      deps.listWindows(),
    ]);
    if (!alive(startedAt)) return null;
    if (!anchor || !probe || pxPerMetre === null || !(pxPerMetre > 0)) return null;
    const monitor = monitorAt(monitors, pos.x, pos.y);
    if (!monitor) return null;
    const scale = sf > 0 ? sf : 1;
    return {
      win,
      scale,
      floor: floorPx(monitor, scale),
      workTop: monitor.workArea.position.y / scale,
      feetX: pos.x / scale + anchor.x,
      feetY: pos.y / scale + anchor.y,
      anchorX: anchor.x,
      anchorY: anchor.y,
      charHpx: probe.charHpx,
      pxPerMetre,
      bounds: {
        x: monitor.position.x / scale,
        y: monitor.position.y / scale,
        width: monitor.size.width / scale,
        height: monitor.size.height / scale,
      },
      windows,
    };
  }

  function yawToWall(side: "left" | "right"): number {
    return side === "left" ? CLIMB_YAW_RAD : -CLIMB_YAW_RAD;
  }

  /**
   * Sample where the hands and feet actually sit against the climbed edge. Diagnostic
   * only: the stand-off distance is tuned from these numbers, nothing reads them back.
   */
  function logGeometry(phase: string, winPhysical: { x: number; y: number }): void {
    const g = geo;
    if (!g) return;
    const feet = renderer.getCharacterAnchor();
    const hands = renderer.getHandAnchors();
    const probe = renderer.getPerchProbe();
    if (!feet || !hands || !probe) return;
    log.debug(
      "climb.geometry",
      climbGeometrySample({
        phase,
        side: g.side,
        edgeX: g.edgeX,
        topY: g.topY,
        win: { x: winPhysical.x / g.scale, y: winPhysical.y / g.scale },
        feet,
        hands,
        hipsY: renderer.getTapPoints()?.hips?.y ?? feet.y,
        clipT: renderer.getCurrentMotionTime(),
        charHpx: probe.charHpx,
      }),
    );
  }

  /**
   * Load a transition clip and measure what the window owes it: the travel the loader
   * detrended out, and the length to spend it over. null when the clip cannot be measured.
   */
  async function measureTransition(
    motionId: string,
    pxPerMetre: number,
  ): Promise<{ px: number; seconds: number } | null> {
    await renderer.preloadMotion(motionId);
    const travelM = renderer.getMotionTravelY(motionId);
    const seconds = renderer.getMotionDuration(motionId);
    if (travelM === null || travelM === 0 || seconds === null || !(seconds > 0)) {
      log.warn("clip_unmeasurable", { degrade: true, motionId });
      return null;
    }
    return { px: Math.abs(travelM) * pxPerMetre, seconds };
  }

  async function runUp(): Promise<void> {
    const startedAt = generation;
    if (reducedMotion()) return;
    const cfg = deps.getConfig();
    const walkCfg = deps.getWalkConfig();
    const w = await survey(startedAt);
    if (!w) return;
    const gate = {
      onFloor: onFloor(w.feetY, w.floor, walkCfg.floor_tolerance_px),
      perched: renderer.isPerched(),
      peeking: deps.isPeeking(),
      dragging: deps.isDragging(),
      ambientMotion: deps.currentMotionKind() === "ambient",
      busy: deps.isBusy(),
      reducedMotion: false,
    };
    if (!canStartStroll(gate)) return;
    const picked = pickClimbTarget({
      windows: w.windows,
      feetX: w.feetX,
      floor: w.floor,
      workTop: w.workTop,
      charHpx: w.charHpx,
      anchorY: w.anchorY,
      monitor: w.bounds,
      cfg,
      maxWalkPx: walkCfg.distance_max_px,
    });
    if (!picked) return;

    target = picked;
    charHpx = w.charHpx;
    floorY = w.floor;
    direction = "up";
    geo = { side: picked.side, edgeX: picked.edgeX, topY: picked.topY, scale: w.scale };
    deps.onStart("up", picked);

    // Stand a hand's reach outside the window's face: the feet on the edge line would
    // straddle it and put the hands inside the window.
    const standX = wallStandX(picked.edgeX, picked.side, cfg.wall_offset_frac * w.charHpx);
    if ((await deps.walker.walkTo(standX - w.anchorX)) !== "arrived") return endClimb();
    if (!alive(startedAt)) return endClimb();
    renderer.setBodyYaw(yawToWall(picked.side), CLIMB_YAW_EASE_MS);

    const at = await w.win.outerPosition();
    if (!alive(startedAt)) return endClimb();
    logGeometry("approach", at);
    const pxPerMetre = w.pxPerMetre * w.scale;
    // The window supplies exactly the travel the loader took out of each clip.
    await renderer.preloadMotion(CLIMB_UP_MOTION_ID);
    const pull = await measureTransition(CLIMB_UP_DONE_MOTION_ID, pxPerMetre);
    if (!pull || !alive(startedAt)) return endClimb();
    const rise = (w.floor - picked.topY) * w.scale;
    const pullPx = Math.min(rise, pull.px);
    // The wall runs a hand's reach outside the face; the corner is where the sit belongs.
    const cornerX = at.x + (picked.edgeX - standX) * w.scale;
    const base = { win: w.win, fromX: at.x, toX: at.x, pxPerMetre, fit: false };
    let y = at.y;

    const loop = await legs.run({
      ...base,
      fromY: y,
      toY: y - (rise - pullPx),
      motionId: CLIMB_UP_MOTION_ID,
      phase: "climb_up",
      linearS: null,
      curveY: true,
      oneshot: false,
      handoffS: 0,
    });
    if (loop !== "done" || !alive(startedAt)) return endClimb();
    y -= rise - pullPx;

    const pullLeg = await legs.run({
      ...base,
      fromY: y,
      toX: cornerX,
      toY: y - pullPx,
      motionId: CLIMB_UP_DONE_MOTION_ID,
      phase: "pull_over",
      linearS: Math.max(pull.seconds - PULL_HANDOFF_S, MAX_STEP_DT_S),
      curveY: true,
      oneshot: true,
      handoffS: PULL_HANDOFF_S,
    });
    if (pullLeg !== "done" || !alive(startedAt)) return endClimb();

    const ledgeAt = await w.win.outerPosition();
    if (!alive(startedAt)) return endClimb();
    logGeometry("ledge", ledgeAt);

    // The pull-over ends on the corner, and a sit pinned there hangs half of some sit
    // clips over the edge. Walk in along the top before sitting down.
    const walkIn = randRange(cfg.ledge_walk_min_frac, cfg.ledge_walk_max_frac, rng) * w.charHpx;
    const seatX = ledgeSeatX(picked.edgeX, picked.side, picked.width, w.charHpx, walkIn);
    // The sit-down crossfades straight out of the held walk clip.
    if ((await deps.walker.walkTo(seatX - w.anchorX, undefined, true)) !== "arrived") {
      return endClimb();
    }
    if (!alive(startedAt)) return endClimb();
    const landed = await w.win.outerPosition();
    if (!alive(startedAt)) return endClimb();
    logGeometry("seat", landed);

    // The window sinks with the sit, and the window manager can refuse part of any move,
    // so the ledge offset has to come from where the window actually ends up.
    if ((await deps.sitter.sitDown({ win: w.win, scale: w.scale })) !== "done") return endClimb();
    if (!alive(startedAt)) return endClimb();
    const seated = await w.win.outerPosition();
    if (!alive(startedAt)) return endClimb();

    endClimb();
    deps.onSit(picked, picked.topY - seated.y / w.scale);
    deps.dropSource.adoptSit(picked.windowNumber, picked.rect, w.charHpx, "adopt");
    dwellAtMs = -1;
  }

  async function runDown(): Promise<void> {
    const startedAt = generation;
    if (reducedMotion() || deps.isDragging() || deps.isPeeking()) return;
    const cfg = deps.getConfig();
    const walkCfg = deps.getWalkConfig();
    const sit = deps.dropSource.armedSit();
    if (sit?.origin !== "adopt") return;
    const w = await survey(startedAt);
    if (!w) return;
    const picked = pickDescentTarget({
      windows: w.windows,
      windowNumber: sit.windowNumber,
      feetX: w.feetX,
      floor: w.floor,
      charHpx: w.charHpx,
      monitor: w.bounds,
      cfg,
    });
    if (!picked) {
      log.debug("descent.no_wall", { windowNumber: sit.windowNumber });
      return;
    }
    const wallOffset = cfg.descent_wall_offset_frac * w.charHpx;
    // Window origin that stands the feet on the ledge. Above the work area the OS would
    // clamp it, so there is nowhere to stand and the sit simply continues.
    const standY = picked.topY - w.anchorY;
    if (standY < w.workTop) {
      log.debug("descent.no_standing_room", { windowNumber: picked.windowNumber, standY });
      return;
    }

    target = picked;
    charHpx = w.charHpx;
    floorY = w.floor;
    direction = "down";
    geo = { side: picked.side, edgeX: picked.edgeX, topY: picked.topY, scale: w.scale };
    deps.dropSource.release();
    deps.onStart("down", picked);

    const released = await awaitRelease();
    if (!alive(startedAt)) return endClimb();
    if (!released) {
      // The exit never came back, so the poll is disarmed while the perch still holds.
      // Take the sit back, or no later dwell can find a wall to climb down.
      deps.dropSource.adoptSit(picked.windowNumber, picked.rect, w.charHpx, "adopt");
      return endClimb();
    }
    // Stand up onto the ledge: the window rises with the clip until the feet are on the
    // edge, wherever a drop left it.
    if ((await deps.sitter.standUp(w.win, Math.round(standY * w.scale))) !== "done") {
      return endClimb();
    }
    if (!alive(startedAt)) return endClimb();
    if ((await deps.walker.walkTo(picked.edgeX - w.anchorX)) !== "arrived") return endClimb();
    if (!alive(startedAt)) return endClimb();
    renderer.setBodyYaw(yawToWall(picked.side), CLIMB_YAW_EASE_MS);

    const at = await w.win.outerPosition();
    if (!alive(startedAt)) return endClimb();
    const pxPerMetre = w.pxPerMetre * w.scale;
    await renderer.preloadMotion(CLIMB_DOWN_MOTION_ID);
    const land = await measureTransition(CLIMB_DOWN_LANDING_MOTION_ID, pxPerMetre);
    if (!land || !alive(startedAt)) return endClimb();
    // A window that does not reach the floor ends the climb at its own bottom edge.
    const grounded = picked.bottomY >= w.floor - walkCfg.floor_tolerance_px;
    const drop = ((grounded ? w.floor : picked.bottomY) - picked.topY) * w.scale;
    const hangPx = Math.min(drop, cfg.hang_frac * w.charHpx * w.scale);
    const landPx = grounded ? Math.min(drop - hangPx, land.px) : 0;
    // She walks the top to the corner, so the wall x is a hand's reach further out.
    const wallX =
      at.x + (wallStandX(picked.edgeX, picked.side, wallOffset) - picked.edgeX) * w.scale;
    const base = { win: w.win, fromX: wallX, toX: wallX, pxPerMetre, fit: false };
    let y = at.y;

    // No clip covers the step off the ledge, so the descent clip crossfades in over a
    // short linear slide that carries her off the corner onto the wall's outer face.
    const hang = await legs.run({
      ...base,
      fromX: at.x,
      fromY: y,
      toY: y + hangPx,
      motionId: CLIMB_DOWN_MOTION_ID,
      phase: "hang",
      linearS: HANG_MS / 1000,
      curveY: false,
      oneshot: false,
      handoffS: 0,
    });
    if (hang !== "done" || !alive(startedAt)) return endClimb();
    y += hangPx;

    const loop = await legs.run({
      ...base,
      fromY: y,
      toY: y + (drop - hangPx - landPx),
      motionId: CLIMB_DOWN_MOTION_ID,
      phase: "descend",
      linearS: null,
      curveY: true,
      oneshot: false,
      handoffS: 0,
    });
    if (loop !== "done" || !alive(startedAt)) return endClimb();
    y += drop - hangPx - landPx;

    if (!grounded) {
      endClimb();
      void deps.faller.drop();
      return;
    }

    const landLeg = await legs.run({
      ...base,
      fromY: y,
      toY: y + landPx,
      motionId: CLIMB_DOWN_LANDING_MOTION_ID,
      phase: "landing",
      linearS: land.seconds,
      curveY: true,
      oneshot: true,
      handoffS: 0,
    });
    if (landLeg !== "done" || !alive(startedAt)) return endClimb();
    endClimb();
  }

  function launch(run: () => Promise<void>): void {
    running = true;
    nextWatchAtMs = nowMs + TARGET_WATCH_MS;
    nextGeoAtMs = nowMs;
    void run()
      .catch((err) => log.warn("climb_failed", { degrade: true, error: String(err) }))
      .finally(() => {
        running = false;
      });
  }

  /** Re-read the stack while the character is committed to a wall she cannot see. */
  function pumpWatch(): void {
    if (!target || watching || nowMs < nextWatchAtMs) return;
    nextWatchAtMs = nowMs + TARGET_WATCH_MS;
    watching = true;
    const startedAt = generation;
    void deps
      .listWindows()
      .then((windows) => {
        if (!alive(startedAt) || !target || !direction) return;
        const lost = climbTargetLost({
          windows,
          target,
          charHpx,
          floor: floorY,
          cfg: deps.getConfig(),
          direction,
        });
        if (!lost) return;
        log.debug("target.lost", { windowNumber: target.windowNumber });
        cancel();
        void deps.faller.drop();
      })
      .catch((err) => log.warn("target_watch_failed", { degrade: true, error: String(err) }))
      .finally(() => {
        watching = false;
      });
  }

  function tick(ctx: { dt: number; elapsed: number }): void {
    nowMs = ctx.elapsed * 1000;
    legs.step(ctx.dt);
    const leg = legs.current();
    if (leg && nowMs >= nextGeoAtMs) {
      nextGeoAtMs = nowMs + GEOMETRY_LOG_MS;
      logGeometry(leg.phase, { x: leg.x, y: leg.y });
    }
    if (releaseWait) {
      if (!renderer.isPerched()) settleReleaseWait(true);
      else if (nowMs >= releaseWait.until) settleReleaseWait(false);
    }
    if (running) {
      pumpWatch();
      return;
    }
    // The dwell belongs to a climb-origin sit; the interval belongs to the floor.
    if (renderer.isPerched()) {
      nextUpAtMs = -1;
      if (deps.dropSource.armedSit()?.origin !== "adopt") {
        dwellAtMs = -1;
        return;
      }
      if (dwellAtMs < 0) {
        dwellAtMs = nowMs + nextDwell(deps.getConfig(), rng);
        return;
      }
      if (nowMs < dwellAtMs) return;
      dwellAtMs = -1;
      launch(runDown);
      return;
    }
    dwellAtMs = -1;
    if (nextUpAtMs < 0) {
      nextUpAtMs = nowMs + nextClimbDelay(deps.getConfig(), rng);
      return;
    }
    if (nowMs < nextUpAtMs) return;
    nextUpAtMs = nowMs + nextClimbDelay(deps.getConfig(), rng);
    launch(runUp);
  }

  const handle: Climber = {
    start() {
      if (unsub) return;
      stopped = false;
      nextUpAtMs = -1;
      dwellAtMs = -1;
      doc?.addEventListener("visibilitychange", onVisibilityChange);
      unsub = renderer.onTick(tick);
    },
    cancel,
    setEnabled(enabled) {
      if (enabled) {
        handle.start();
        return;
      }
      // Switching off while she hangs strands her on the wall — take her off it.
      const onWall = direction !== null;
      handle.stop();
      if (onWall) void deps.faller.drop();
    },
    stop() {
      stopped = true;
      cancel();
      unsub?.();
      unsub = null;
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
  return handle;
}
