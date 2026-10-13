export interface ScreenPoint {
  x: number;
  y: number;
}

/** The logical point for a physical one, over the scale of the display or window it belongs to. */
export function physicalToLogicalScreenPoint(point: ScreenPoint, scaleFactor: number): ScreenPoint {
  return { x: point.x / scaleFactor, y: point.y / scaleFactor };
}
