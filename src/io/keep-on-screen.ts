/**
 * keep-on-screen — pushes a window back so its center lands on some monitor.
 *
 * A window passes when its center point sits inside the full bounds (position+size,
 * not workArea) of any monitor — partial overhang past an edge is allowed on purpose.
 * Otherwise it is pushed by the minimum distance: for each monitor, clamp the center
 * into that monitor's bounds, then take the monitor whose clamp moves the center least.
 */

import type { Logger } from "../logger";
import { monitorAt, type ScreenMonitor } from "./screen-geometry";

/** Idle time after the last move event before the guard evaluates. */
const IDLE_MS = 300;

/** Window accessors the guard reads and writes. Positions/sizes are physical px. */
export interface KeepOnScreenWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  setPositionPhysical(x: number, y: number): Promise<void>;
  onMoved(cb: () => void): Promise<() => void>;
}

/** The origin that lands the center on the nearest monitor, or null when already on screen. */
export function keepOnScreen(
  monitors: ScreenMonitor[],
  pos: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number } | null {
  const centerX = pos.x + size.width / 2;
  const centerY = pos.y + size.height / 2;
  if (monitorAt(monitors, centerX, centerY) || monitors.length === 0) return null;

  let nearest: { x: number; y: number } | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const m of monitors) {
    const clampedX = Math.min(Math.max(centerX, m.position.x), m.position.x + m.size.width);
    const clampedY = Math.min(Math.max(centerY, m.position.y), m.position.y + m.size.height);
    const dist = (clampedX - centerX) ** 2 + (clampedY - centerY) ** 2;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { x: clampedX - size.width / 2, y: clampedY - size.height / 2 };
    }
  }
  return nearest;
}

/** Debounced onMoved evaluation plus one startup pass, since opening a window emits no move event. */
export async function attachKeepOnScreen(
  win: KeepOnScreenWindow,
  listMonitors: () => Promise<ScreenMonitor[]>,
  log: Logger,
): Promise<() => void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const evaluate = async (): Promise<void> => {
    if (disposed) return;
    const [monitors, pos, size] = await Promise.all([
      listMonitors(),
      win.outerPosition(),
      win.outerSize(),
    ]);
    if (disposed) return;
    const pushed = keepOnScreen(monitors, pos, size);
    // Landing exactly on a monitor's far edge re-fails the strict `monitorAt` upper bound,
    // so a pushed position can recompute to itself — skip the no-op setPosition/onMoved round-trip.
    if (!pushed || (pushed.x === pos.x && pushed.y === pos.y)) return;
    log.info("keep_on_screen_push", { fromX: pos.x, fromY: pos.y, toX: pushed.x, toY: pushed.y });
    await win.setPositionPhysical(pushed.x, pushed.y);
  };

  // ponytail: holding the window still off-screen mid-drag past IDLE_MS fires the guard during
  // the drag; upgrade path is gating this on drag start/end instead of on move-quiet alone.
  const unlisten = await win.onMoved(() => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void evaluate();
    }, IDLE_MS);
  });
  void evaluate();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unlisten();
  };
}
