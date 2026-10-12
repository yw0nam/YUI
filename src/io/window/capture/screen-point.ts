import { monitorAt, type ScreenMonitor } from "../geometry/screen-geometry";

export interface ScreenPoint {
  x: number;
  y: number;
}

export function physicalToLogicalScreenPoint(
  point: ScreenPoint,
  monitors: ScreenMonitor[],
): ScreenPoint | null {
  const monitor = monitorAt(monitors, point.x, point.y);
  return monitor ? { x: point.x / monitor.scaleFactor, y: point.y / monitor.scaleFactor } : null;
}
