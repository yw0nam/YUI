/**
 * Where a companion window (the message window, the unified chat window) opens beside the window
 * that opens it. initialCompanionPosition is the pure placement rule; resolveCompanionPosition reads
 * the opening window and the monitors through Tauri, dynamic-imported so vitest never loads it.
 */

import { clampToWorkArea, monitorAt, type ScreenMonitor, toScreenMonitor } from "./screen-geometry";

/** Gap (logical px) between the pet window's right edge and the companion window. */
const COMPANION_GAP_PX = 12;
/** Fixed width (logical px) of a companion column window; its bubble and input size to it. */
export const COMPANION_COLUMN_WIDTH = 340;
/** Height (logical px) of an idle companion window — a 26px handle and its border inside the column's 8px padding. */
export const COMPANION_HANDLE_HEIGHT = 44;

interface CompanionPlacement {
  /** Last stored outer position (physical px), null until the window has been moved. */
  stored: { x: number | null; y: number | null };
  /** Pet window outer bounds (physical px). */
  pet: { position: { x: number; y: number }; size: { width: number; height: number } };
  monitors: ScreenMonitor[];
  scale: number;
  /** The window box (logical px) the position must keep on screen. */
  size: { width: number; height: number };
}

/**
 * Where a companion window opens, in physical px: the stored position when there
 * is one, else beside the pet window's top-right corner — clamped either way into
 * the work area of the monitor holding the pet window.
 */
export function initialCompanionPosition({
  stored,
  pet,
  monitors,
  scale,
  size,
}: CompanionPlacement): { x: number; y: number } {
  const candidate =
    stored.x !== null && stored.y !== null
      ? { x: stored.x, y: stored.y }
      : {
          x: pet.position.x + pet.size.width + COMPANION_GAP_PX * scale,
          y: pet.position.y,
        };
  // A window parked on a second display must be clamped there, not dragged back to the pet's.
  const monitor =
    monitorAt(monitors, candidate.x, candidate.y) ??
    monitorAt(monitors, pet.position.x, pet.position.y);
  if (!monitor || scale <= 0) return candidate;
  const clamped = clampToWorkArea(
    candidate.x / scale,
    candidate.y / scale,
    size.width,
    size.height,
    monitor.workArea.position.x / scale,
    monitor.workArea.position.y / scale,
    monitor.workArea.size.width / scale,
    monitor.workArea.size.height / scale,
  );
  return { x: Math.round(clamped.x * scale), y: Math.round(clamped.y * scale) };
}

/** Where to open, in logical px — the unit the window constructor takes — beside the current window. */
export async function resolveCompanionPosition(stored: {
  x: number | null;
  y: number | null;
}): Promise<{ x: number; y: number }> {
  const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const [position, outer, scale, monitors] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.scaleFactor(),
    availableMonitors(),
  ]);
  const physical = initialCompanionPosition({
    stored,
    pet: {
      position: { x: position.x, y: position.y },
      size: { width: outer.width, height: outer.height },
    },
    monitors: monitors.map(toScreenMonitor),
    scale,
    size: { width: COMPANION_COLUMN_WIDTH, height: COMPANION_HANDLE_HEIGHT },
  });
  return { x: physical.x / scale, y: physical.y / scale };
}
