export type TapRegion = "head" | "chest" | "hips";
export type CssPoint = { x: number; y: number };

export interface TapRegionBones {
  head: CssPoint | null;
  chest: CssPoint | null;
  hips: CssPoint | null;
}

/** Nearest-first order — an equal-distance tie resolves to the upper region. */
const REGIONS: readonly TapRegion[] = ["head", "chest", "hips"];

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

  let nearest: TapRegion | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const region of REGIONS) {
    const bone = bones[region];
    if (!bone) continue;
    const distance = distanceSquared(bone);
    if (distance >= nearestDistance) continue;
    nearest = region;
    nearestDistance = distance;
  }
  return nearestDistance <= radius ** 2 ? nearest : null;
}
