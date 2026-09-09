/**
 * keep-on-screen — pushes a window back so its center lands on some monitor.
 *
 * A window passes when its center point sits inside the full bounds (position+size,
 * not workArea) of any monitor — partial overhang past an edge is allowed on purpose.
 * Otherwise it is pushed by the minimum distance: for each monitor, clamp the center
 * into that monitor's bounds, then take the monitor whose clamp moves the center least.
 */

import { createLogger } from "../logger";
import { monitorAt, type ScreenMonitor } from "./screen-geometry";

const log = createLogger("keep-on-screen");

/** Idle time after the last move event before the guard evaluates. */
const IDLE_MS = 300;

/** Physical px kept between a pushed center and the monitor's far edge. */
const EDGE_INSET_PX = 2;

/** Window accessors the guard reads and writes. Positions/sizes are physical px. */
export interface KeepOnScreenWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  setPositionPhysical(x: number, y: number): Promise<void>;
  onMoved(cb: () => void): Promise<() => void>;
  onResized(cb: () => void): Promise<() => void>;
}

/**
 * The origin that lands the center on the nearest monitor, or null when already on screen.
 * `inset` shrinks every monitor's bounds by that much on each side before the check — passing
 * half the window's size requires the whole window (not just its center) to end up on screen.
 */
export function keepOnScreen(
  monitors: ScreenMonitor[],
  pos: { x: number; y: number },
  size: { width: number; height: number },
  inset: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } | null {
  const centerX = pos.x + size.width / 2;
  const centerY = pos.y + size.height / 2;
  const bounds = monitors.map((m) => ({
    position: { x: m.position.x + inset.x, y: m.position.y + inset.y },
    size: { width: m.size.width - 2 * inset.x, height: m.size.height - 2 * inset.y },
    workArea: m.workArea,
    scaleFactor: m.scaleFactor,
  }));
  if (monitorAt(bounds, centerX, centerY)) return null;

  let nearest: { x: number; y: number } | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const m of bounds) {
    // monitorAt's upper bound is exclusive, and the OS rounds the origin to whole logical points,
    // so stay EDGE_INSET_PX inside the far edge or the pushed center can land back on it.
    const maxX = m.position.x + m.size.width - EDGE_INSET_PX;
    const maxY = m.position.y + m.size.height - EDGE_INSET_PX;
    const clampedX = Math.min(Math.max(centerX, m.position.x), maxX);
    const clampedY = Math.min(Math.max(centerY, m.position.y), maxY);
    const dist = (clampedX - centerX) ** 2 + (clampedY - centerY) ** 2;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = {
        x: Math.round(clampedX - size.width / 2),
        y: Math.round(clampedY - size.height / 2),
      };
    }
  }
  return nearest;
}

/** The guard's handle: teardown, plus a pause a travel holds while it parks the window itself. */
export interface KeepOnScreenHandle {
  dispose(): void;
  /** While paused, a moved/resized event does nothing; unpausing evaluates once right away. */
  setPaused(paused: boolean): void;
}

/** Debounced onMoved/onResized evaluation plus one startup pass, since opening emits neither. */
export async function attachKeepOnScreen(
  win: KeepOnScreenWindow,
  listMonitors: () => Promise<ScreenMonitor[]>,
  opts: { wholeWindow?: boolean } = {},
): Promise<KeepOnScreenHandle> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let running = false;
  let paused = false;

  const evaluate = async (): Promise<void> => {
    if (disposed || running) return;
    running = true;
    try {
      const [monitors, pos, size] = await Promise.all([
        listMonitors(),
        win.outerPosition(),
        win.outerSize(),
      ]);
      if (disposed) return;
      // Content-driven size, so the inset is recomputed from the current outerSize every pass.
      const inset = opts.wholeWindow ? { x: size.width / 2, y: size.height / 2 } : undefined;
      const pushed = keepOnScreen(monitors, pos, size, inset);
      if (!pushed) return;
      log.info("keep_on_screen_push", { fromX: pos.x, fromY: pos.y, toX: pushed.x, toY: pushed.y });
      await win.setPositionPhysical(pushed.x, pushed.y);
    } finally {
      running = false;
    }
  };

  const run = (): void => {
    if (paused) return;
    void evaluate().catch((error) =>
      log.warn("keep_on_screen_eval_failed", { error: String(error) }),
    );
  };

  const schedule = (): void => {
    if (disposed || paused) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, IDLE_MS);
  };

  // ponytail: holding the window still off-screen mid-drag past IDLE_MS fires the guard during
  // the drag; gate on drag start/end if that bites.
  const unlistenMoved = await win.onMoved(schedule);
  const unlistenResized = await win.onResized(schedule);
  run();

  return {
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      unlistenMoved();
      unlistenResized();
    },
    setPaused(next) {
      paused = next;
      if (paused) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      run();
    },
  };
}
