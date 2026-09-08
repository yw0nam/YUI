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

/** One monitor's physical bounds, its own scale factor, and its work area (screen minus menu bar/dock). */
export interface ScreenMonitor {
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
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
    scaleFactor: monitor.scaleFactor,
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

/** The floor line — the monitor's work-area bottom in logical px, its own scale factor applied. */
export function floorPx(monitor: ScreenMonitor): number {
  return (monitor.workArea.position.y + monitor.workArea.size.height) / monitor.scaleFactor;
}

/** A monitor's work area in logical px. */
export function logicalWorkArea(monitor: ScreenMonitor): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { scaleFactor } = monitor;
  return {
    x: monitor.workArea.position.x / scaleFactor,
    y: monitor.workArea.position.y / scaleFactor,
    width: monitor.workArea.size.width / scaleFactor,
    height: monitor.workArea.size.height / scaleFactor,
  };
}

/**
 * The logical x-range the floor of `monitor` continues over: its work area plus every
 * neighbour with the same scale and floor line that touches it, chained transitively.
 */
export function floorSpan(
  monitors: ScreenMonitor[],
  monitor: ScreenMonitor,
): { left: number; right: number } {
  const floor = floorPx(monitor);
  const start = logicalWorkArea(monitor);
  let left = start.x;
  let right = start.x + start.width;
  const absorbed = new Set([monitor]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const candidate of monitors) {
      if (absorbed.has(candidate)) continue;
      if (candidate.scaleFactor !== monitor.scaleFactor) continue;
      if (Math.abs(floorPx(candidate) - floor) > 1) continue;
      const wa = logicalWorkArea(candidate);
      const candLeft = wa.x;
      const candRight = wa.x + wa.width;
      if (candRight < left - 1 || candLeft > right + 1) continue;
      left = Math.min(left, candLeft);
      right = Math.max(right, candRight);
      absorbed.add(candidate);
      grew = true;
    }
  }
  return { left, right };
}

/** Physical window y that rests the feet on the floor line. */
export function groundedWindowY(
  floorLogicalPx: number,
  feetOffsetLogicalPx: number,
  scale: number,
): number {
  return (floorLogicalPx - feetOffsetLogicalPx) * scale;
}
