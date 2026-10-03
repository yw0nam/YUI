/** Pure orbit, pinch and tap recognizer over pointer ids; timestamps come in with the events. */
import type { OrbitDelta } from "../../../settings/avatar/camera-gestures";
import { exceedsPressTravel } from "../press-travel";

export interface TouchPoint {
  x: number;
  y: number;
}

export interface TouchGestureCallbacks {
  /** One finger moved past the press travel: per-move delta in client CSS px. */
  onOrbit(delta: OrbitDelta): void;
  /** A second finger landed with a measurable spread: the consumer captures its zoom. */
  onPinchStart(): void;
  /** Current spread over the spread at pinch start. */
  onPinch(ratio: number): void;
  /** One finger came up short and still, with the release point in client CSS px. */
  onTap(pos: TouchPoint): void;
}

export interface TouchGesture {
  down(id: number, pos: TouchPoint, t: number): void;
  move(id: number, pos: TouchPoint): void;
  up(id: number, pos: TouchPoint, t: number): void;
  cancel(id: number): void;
  /** Forgets every finger without a callback. */
  reset(): void;
}

/** A press released later than this is no tap: Android's default long-press timeout. */
const TAP_MAX_MS = 400;
/** Below this spread (CSS px) two fingers hold the pinch unarmed. */
const PINCH_MIN_SPREAD_PX = 1;

export function createTouchGesture(cb: TouchGestureCallbacks): TouchGesture {
  // Insertion order is landing order.
  const fingers = new Map<number, TouchPoint>();
  // The single press that may still become a tap.
  let press: { start: TouchPoint; t0: number } | null = null;
  let orbiting: { id: number; last: TouchPoint } | null = null;
  // A null baseline holds two fingers too close to measure a ratio from.
  let pinch: { baseline: number | null } | null = null;
  // A second finger landed at some point in this gesture, so no tap can follow.
  let multi = false;

  function spread(): number {
    const [a, b] = [...fingers.values()];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function reset(): void {
    fingers.clear();
    press = null;
    orbiting = null;
    pinch = null;
    multi = false;
  }

  function down(id: number, pos: TouchPoint, t: number): void {
    if (fingers.has(id)) return;
    fingers.set(id, pos);
    if (fingers.size === 1) {
      press = { start: pos, t0: t };
      orbiting = null;
      multi = false;
    } else if (fingers.size === 2) {
      multi = true;
      press = null;
      orbiting = null;
      const s = spread();
      pinch = { baseline: s >= PINCH_MIN_SPREAD_PX ? s : null };
      if (pinch.baseline !== null) cb.onPinchStart();
    } else {
      pinch = null;
      orbiting = null;
    }
  }

  function moveOne(id: number, pos: TouchPoint): void {
    if (orbiting?.id === id) {
      const last = orbiting.last;
      orbiting.last = pos;
      cb.onOrbit({ dx: pos.x - last.x, dy: pos.y - last.y });
    } else if (press && exceedsPressTravel(press.start, pos)) {
      const start = press.start;
      press = null;
      orbiting = { id, last: pos };
      cb.onOrbit({ dx: pos.x - start.x, dy: pos.y - start.y });
    }
  }

  function moveTwo(): void {
    if (!pinch) return;
    const s = spread();
    if (pinch.baseline === null) {
      if (s < PINCH_MIN_SPREAD_PX) return;
      pinch.baseline = s;
      cb.onPinchStart();
    } else if (Number.isFinite(s) && s > 0) {
      cb.onPinch(s / pinch.baseline);
    }
  }

  function move(id: number, pos: TouchPoint): void {
    if (!fingers.has(id)) return;
    fingers.set(id, pos);
    if (fingers.size === 1) moveOne(id, pos);
    else if (fingers.size === 2) moveTwo();
  }

  /** Drops one of several fingers; one left re-arms the orbit from its own position. */
  function lift(id: number): void {
    fingers.delete(id);
    if (fingers.size !== 1) return;
    const [[remaining, last]] = fingers;
    orbiting = { id: remaining, last };
    press = null;
    pinch = null;
  }

  function up(id: number, pos: TouchPoint, t: number): void {
    if (!fingers.has(id)) return;
    if (fingers.size > 1) {
      lift(id);
      return;
    }
    const tap =
      press !== null &&
      !multi &&
      !exceedsPressTravel(press.start, pos) &&
      t - press.t0 <= TAP_MAX_MS;
    reset();
    if (tap) cb.onTap(pos);
  }

  function cancel(id: number): void {
    if (!fingers.has(id)) return;
    if (fingers.size > 1) lift(id);
    else reset();
  }

  return { down, move, up, cancel, reset };
}
