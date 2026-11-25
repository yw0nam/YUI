import { isObject } from "../shared";
import { nonNegative, num, positive, type SectionContext, unit } from "./helpers";
import type { StageConfig } from "./types";

// stage — her travel onto the settings stage and her staying away from it.
export function validateStage(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<StageConfig> {
  const { issues } = ctx;
  const stage: Partial<StageConfig> = {};
  const rawStage = raw.stage;
  if (!isObject(rawStage)) {
    issues.push(`stage must be an object (got: ${JSON.stringify(rawStage)})`);
  } else {
    for (const field of ["walk_ms", "walk_full_pt", "emotion_decay_min"] as const) {
      stage[field] = num(issues, rawStage, "stage", field, positive, "a finite number > 0");
    }
    stage.walk_extra_ms = num(
      issues,
      rawStage,
      "stage",
      "walk_extra_ms",
      nonNegative,
      "a finite number >= 0",
    );
    stage.stay_chance = num(
      issues,
      rawStage,
      "stage",
      "stay_chance",
      unit,
      "a finite number in [0, 1]",
    );
  }
  return stage;
}
