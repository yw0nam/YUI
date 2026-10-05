import { isObject } from "../shared";
import {
  int,
  nonNegative,
  num,
  positive,
  requireOrder,
  type SectionContext,
  unit,
} from "./helpers";
import type { PerchWalkConfig, WalkConfig } from "./types";

// walk — ambient floor stroll.
export function validateWalk(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<WalkConfig> {
  const { issues } = ctx;
  const walk: Partial<WalkConfig> = {};
  const rawWalk = raw.walk;
  if (!isObject(rawWalk)) {
    issues.push(`walk must be an object (got: ${JSON.stringify(rawWalk)})`);
  } else {
    for (const field of [
      "interval_min_ms",
      "interval_max_ms",
      "distance_min_px",
      "distance_max_px",
    ] as const) {
      walk[field] = num(issues, rawWalk, "walk", field, positive, "a finite number > 0");
    }
    walk.floor_tolerance_px = num(
      issues,
      rawWalk,
      "walk",
      "floor_tolerance_px",
      nonNegative,
      "a finite number >= 0",
    );
    requireOrder(
      issues,
      "walk",
      "interval_min_ms",
      walk.interval_min_ms,
      "interval_max_ms",
      walk.interval_max_ms,
    );
    requireOrder(
      issues,
      "walk",
      "distance_min_px",
      walk.distance_min_px,
      "distance_max_px",
      walk.distance_max_px,
    );
  }
  return walk;
}

// perch_walk — ambient stroll along a window top.
export function validatePerchWalk(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<PerchWalkConfig> {
  const { issues } = ctx;
  const perch_walk: Partial<PerchWalkConfig> = {};
  const rawPerchWalk = raw.perch_walk;
  if (!isObject(rawPerchWalk)) {
    issues.push(`perch_walk must be an object (got: ${JSON.stringify(rawPerchWalk)})`);
  } else {
    for (const field of ["dwell_min_ms", "dwell_max_ms"] as const) {
      perch_walk[field] = int(
        issues,
        rawPerchWalk,
        "perch_walk",
        field,
        nonNegative,
        "an integer >= 0",
      );
    }
    for (const field of ["distance_min_px", "distance_max_px"] as const) {
      perch_walk[field] = num(
        issues,
        rawPerchWalk,
        "perch_walk",
        field,
        positive,
        "a finite number > 0",
      );
    }
    perch_walk.edge_margin_frac = num(
      issues,
      rawPerchWalk,
      "perch_walk",
      "edge_margin_frac",
      unit,
      "a finite number in [0, 1]",
    );
    perch_walk.level_tolerance_px = num(
      issues,
      rawPerchWalk,
      "perch_walk",
      "level_tolerance_px",
      nonNegative,
      "a finite number >= 0",
    );
    requireOrder(
      issues,
      "perch_walk",
      "dwell_min_ms",
      perch_walk.dwell_min_ms,
      "dwell_max_ms",
      perch_walk.dwell_max_ms,
    );
    requireOrder(
      issues,
      "perch_walk",
      "distance_min_px",
      perch_walk.distance_min_px,
      "distance_max_px",
      perch_walk.distance_max_px,
    );
  }
  return perch_walk;
}
