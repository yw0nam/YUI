export type TapRegion = "chest" | "hips";
export type CssPoint = { x: number; y: number };

export interface TapRegionBones {
  chest: CssPoint | null;
  hips: CssPoint | null;
}

export function classifyTapRegion(
  pointCss: CssPoint,
  bones: TapRegionBones,
  charHpx: number,
  radiusFrac: number,
): TapRegion | null {
  const radius = charHpx * radiusFrac;
  if (!Number.isFinite(radius) || radius <= 0) return null;

  const distanceSquared = (point: CssPoint): number =>
    (pointCss.x - point.x) ** 2 + (pointCss.y - point.y) ** 2;
  const chestDistance = bones.chest ? distanceSquared(bones.chest) : Number.POSITIVE_INFINITY;
  const hipsDistance = bones.hips ? distanceSquared(bones.hips) : Number.POSITIVE_INFINITY;
  const maxDistance = radius ** 2;

  if (chestDistance <= hipsDistance && chestDistance <= maxDistance) return "chest";
  if (hipsDistance <= maxDistance) return "hips";
  return null;
}
