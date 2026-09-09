/**
 * screen-geometry — the monitor and floor math every window mover shares.
 *
 * The ambient stroll, the drag-release fall and the agent's `move_to` all place the
 * same OS window against the same floor line, so the containment test and the
 * work-area bottom live here once.
 *
 * The floor is the work-area bottom of the monitor holding the window origin, and the
 * character stands on it with her *feet* — the anchor the renderer projects, not the
 * window box, which hangs below the floor by the framing margin.
 *
 * Monitor bounds and window positions are physical px; the floor line and the feet
 * offset are logical px, since that is what the renderer projects in.
 */

/** Pet window accessors the movers read and write. Position/size reads are physical px. */
export interface PetWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
  /** Scale-independent global logical points — the OS resolves them against whichever
   *  monitor the window ends up on, unlike a physical move, which reads the starting scale. */
  setPositionLogical(x: number, y: number): Promise<void>;
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

/** The monitor whose bounds, converted to logical px, contain the point, or null. */
export function monitorAtLogical(
  monitors: ScreenMonitor[],
  x: number,
  y: number,
): ScreenMonitor | null {
  return (
    monitors.find((m) => {
      const left = m.position.x / m.scaleFactor;
      const top = m.position.y / m.scaleFactor;
      return (
        x >= left &&
        x < left + m.size.width / m.scaleFactor &&
        y >= top &&
        y < top + m.size.height / m.scaleFactor
      );
    }) ?? null
  );
}

/** How far apart two floor lines may read and still count as the same one, float rounding included. */
export const FLOOR_LINE_TOLERANCE_PX = 1;

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
 * Window-origin x ranges a stroll may use on `monitor`'s floor: the same-floor span minus
 * every stretch where a window of `windowWidth` standing on the line would overlap another
 * monitor through the `hangPx` it hangs below the feet.
 */
export function floorSegments(
  monitors: ScreenMonitor[],
  monitor: ScreenMonitor,
  windowWidth: number,
  hangPx: number,
): Array<{ left: number; right: number }> {
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
      if (Math.abs(floorPx(candidate) - floor) > FLOOR_LINE_TOLERANCE_PX) continue;
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
  let segments = [{ left, right: right - windowWidth }];
  for (const other of monitors) {
    if (absorbed.has(other)) continue;
    // The flash this guards against is a backing-scale mismatch, not overlap on its own —
    // a same-scale monitor stacked below redraws cleanly and never needs the cut.
    if (other.scaleFactor === monitor.scaleFactor) continue;
    const top = other.position.y / other.scaleFactor;
    const bottom = top + other.size.height / other.scaleFactor;
    if (bottom <= floor || top >= floor + hangPx) continue;
    const cutLeft = other.position.x / other.scaleFactor - windowWidth;
    const cutRight = (other.position.x + other.size.width) / other.scaleFactor;
    segments = segments.flatMap((seg) => cutSegment(seg, cutLeft, cutRight));
  }
  return segments.filter((seg) => seg.left <= seg.right);
}

/**
 * `x` when it already lies inside one of `segments`, else the nearest segment end.
 * `x` unchanged when `segments` is empty — a travel exists precisely to cross the
 * stretches this would otherwise clamp out of.
 */
export function clampToFloorSegments(
  segments: Array<{ left: number; right: number }>,
  x: number,
): number {
  let best = x;
  let bestDist = Infinity;
  for (const seg of segments) {
    const clamped = Math.min(Math.max(x, seg.left), seg.right);
    const dist = Math.abs(clamped - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = clamped;
    }
  }
  return best;
}

/** `seg` with the window-origin stretch [cutLeft, cutRight) removed. */
function cutSegment(
  seg: { left: number; right: number },
  cutLeft: number,
  cutRight: number,
): Array<{ left: number; right: number }> {
  if (cutRight <= seg.left || cutLeft >= seg.right) return [seg];
  const pieces: Array<{ left: number; right: number }> = [];
  if (cutLeft > seg.left) pieces.push({ left: seg.left, right: cutLeft });
  if (cutRight < seg.right) pieces.push({ left: cutRight, right: seg.right });
  return pieces;
}
