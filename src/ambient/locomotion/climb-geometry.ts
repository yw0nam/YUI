/**
 * climb-geometry — pure planning and target selection for the wall climb.
 *
 * Every function here takes the window list, the monitor bounds and the config it needs
 * and returns a plain value; the timers, the window reads and the per-frame translation
 * all live with createClimber in climber.ts. Coordinates are global logical px unless a
 * field says otherwise.
 */

import type { ClimbConfig } from "../../config/load";
import type { WindowRect } from "../../contract";
import { MOVE_TH } from "../../io/window/geometry/perch";
import {
  type DescentEdge,
  FLOOR_LINE_TOLERANCE_PX,
  floorPx,
  logicalWorkArea,
  type ScreenMonitor,
} from "../../io/window/geometry/screen-geometry";
import { type Rng, randRange } from "../liveliness/cues";

/** The wall a climb runs on: a foreign window's side, or a screen edge onto the monitor above. */
export interface ClimbTarget {
  /** -1 for a monitor wall — there is no window to name. */
  windowNumber: number;
  side: "left" | "right";
  /** Global x (logical px) of the climbed edge. */
  edgeX: number;
  topY: number;
  bottomY: number;
  /** Window width — how much ledge there is to walk in along before sitting. 0 for a monitor wall. */
  width: number;
  /** Window origin at pick time — the poll's move baseline. The screen edge for a monitor wall. */
  rect: { x: number; y: number };
  app: string | null;
  title: string | null;
  kind: "window" | "monitor";
}

/** An axis-aligned rect in the same global logical px as the window list. */
export interface Box {
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

/** Whether two descent edges name the same seam, float rounding included. */
export function sameDescentEdge(a: DescentEdge, b: DescentEdge): boolean {
  return (
    a.side === b.side &&
    Math.abs(a.edgeX - b.edgeX) <= FLOOR_LINE_TOLERANCE_PX &&
    Math.abs(a.topY - b.topY) <= FLOOR_LINE_TOLERANCE_PX &&
    Math.abs(a.bottomY - b.bottomY) <= FLOOR_LINE_TOLERANCE_PX
  );
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
interface ClimbGeometrySample {
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
          kind: "window",
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
      kind: "window",
    };
  }
  return null;
}

/**
 * The screen edges of `monitor` that lead up onto another monitor's floor line: a side
 * is a wall when a different monitor's logical floor sits within 1 px of `monitor`'s
 * logical top and its work area spans the edge. A screen edge is always climbable — no
 * foreign window can cover it. All arguments and results are global logical px except
 * the monitor bounds, which carry their own physical/scale pair.
 */
export function pickMonitorWalls(args: {
  monitors: ScreenMonitor[];
  /** The one the pet stands on. */
  monitor: ScreenMonitor;
  feetX: number;
  /** Logical floor of `monitor`. */
  floor: number;
  /** Longest approach walk, borrowed from the stroll's own reach. */
  maxWalkPx: number;
}): ClimbTarget[] {
  const { monitors, monitor, feetX, floor, maxWalkPx } = args;
  const top = monitor.position.y / monitor.scaleFactor;
  const left = monitor.position.x / monitor.scaleFactor;
  const right = left + monitor.size.width / monitor.scaleFactor;
  // The character climbs the inside of the screen: the left edge is a window's right
  // wall (stand to its right, face left) and the right edge is a window's left wall.
  const sides: Array<{ side: "left" | "right"; edgeX: number }> = [
    { side: "right", edgeX: left },
    { side: "left", edgeX: right },
  ];
  const targets: ClimbTarget[] = [];
  for (const { side, edgeX } of sides) {
    if (Math.abs(edgeX - feetX) > maxWalkPx) continue;
    const upper = monitors.find((u) => {
      if (u === monitor) return false;
      if (Math.abs(floorPx(u) - top) > FLOOR_LINE_TOLERANCE_PX) return false;
      const wa = logicalWorkArea(u);
      return edgeX >= wa.x && edgeX <= wa.x + wa.width;
    });
    if (!upper) continue;
    const topY = floorPx(upper);
    targets.push({
      windowNumber: -1,
      side,
      edgeX,
      topY,
      bottomY: floor,
      width: 0,
      rect: { x: edgeX, y: topY },
      app: null,
      title: null,
      kind: "monitor",
    });
  }
  return targets;
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
  // A monitor wall is the screen edge itself: it cannot move, vanish, or be covered.
  if (target.kind === "monitor") return false;
  const wallOffset =
    (direction === "down" ? cfg.descent_wall_offset_frac : cfg.wall_offset_frac) * charHpx;
  const index = windows.findIndex((w) => w.windowNumber === target.windowNumber);
  if (index < 0) return true;
  const win = windows[index];
  if (Math.abs(win.x - target.rect.x) > MOVE_TH || Math.abs(win.y - target.rect.y) > MOVE_TH) {
    return true;
  }
  const front = windows.slice(0, index);
  const column = wallColumn(target.edgeX, target.topY, floor, wallOffset, target.side);
  const seat = cornerSeat(target.edgeX, target.topY, target.side, wallOffset);
  return front.some((w) => overlaps(w, column) || containsPoint(w, seat));
}
