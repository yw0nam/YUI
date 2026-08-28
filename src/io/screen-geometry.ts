/**
 * screen-geometry — the monitor and floor math every window mover shares.
 *
 * The ambient stroll, the drag-release fall and the agent's `move_to` all place the
 * same OS window against the same floor line, so the containment test, the work-area
 * bottom and the grounded window origin live here once.
 *
 * The floor is the work-area bottom of the monitor holding the window origin, and the
 * character stands on it with her *feet* — the anchor the renderer projects, not the
 * window box, which hangs below the floor by the framing margin.
 *
 * Monitor bounds and window positions are physical px; the floor line and the feet
 * offset are logical px, since that is what the renderer projects in.
 */

/** Pet window accessors the movers read and write. Positions/sizes are physical px. */
export interface PetWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
  setPositionPhysical(x: number, y: number): Promise<void>;
}

/** One monitor's physical bounds plus its work area (screen minus menu bar/dock). */
export interface ScreenMonitor {
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
}

/** Narrow a Tauri monitor to the bounds the movers read. */
export function toScreenMonitor(monitor: ScreenMonitor): ScreenMonitor {
  return {
    position: { x: monitor.position.x, y: monitor.position.y },
    size: { width: monitor.size.width, height: monitor.size.height },
    workArea: {
      position: { x: monitor.workArea.position.x, y: monitor.workArea.position.y },
      size: { width: monitor.workArea.size.width, height: monitor.workArea.size.height },
    },
  };
}

/** The monitor whose bounds contain the point, or null. */
export function monitorAt(monitors: ScreenMonitor[], x: number, y: number): ScreenMonitor | null {
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

/** The floor line — the monitor's work-area bottom in logical px. */
export function floorPx(monitor: ScreenMonitor, scale: number): number {
  return (monitor.workArea.position.y + monitor.workArea.size.height) / scale;
}

/** Physical window y that rests the feet on the floor line. */
export function groundedWindowY(
  floorLogicalPx: number,
  feetOffsetLogicalPx: number,
  scale: number,
): number {
  return (floorLogicalPx - feetOffsetLogicalPx) * scale;
}
