import { isObject } from "../shared";
import { nonNegative, num, positive, type SectionContext, unit } from "./helpers";
import type { EdgeEntry, EntryFamily, StageConfig } from "./types";

/** obj[key] when it is a non-empty array of non-empty strings; records `path.key` otherwise. */
function strings(
  issues: string[],
  obj: Record<string, unknown>,
  path: string,
  key: string,
): string[] | undefined {
  const value = obj[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v) => typeof v === "string" && v.length > 0)
  ) {
    issues.push(
      `${path}.${key} must be a non-empty array of non-empty strings (got: ${JSON.stringify(value)})`,
    );
    return undefined;
  }
  return value as string[];
}

/** Each named object under `stage[key]`, read by `read`; every `required` name must be one. */
function namedObjects<T>(
  issues: string[],
  rawStage: Record<string, unknown>,
  key: string,
  required: readonly string[],
  read: (obj: Record<string, unknown>, path: string) => T,
): Record<string, T> | undefined {
  const path = `stage.${key}`;
  const rawMap = rawStage[key];
  if (!isObject(rawMap)) {
    issues.push(`${path} must be an object (got: ${JSON.stringify(rawMap)})`);
    return undefined;
  }
  const out: Record<string, T> = {};
  for (const name of new Set([...required, ...Object.keys(rawMap)])) {
    const value = rawMap[name];
    if (!isObject(value)) {
      issues.push(`${path}.${name} must be an object (got: ${JSON.stringify(value)})`);
      continue;
    }
    out[name] = read(value, `${path}.${name}`);
  }
  return out;
}

// stage — her travel onto the settings stage, her entry on it, and her staying away from it.
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
    for (const field of ["carry_ms", "carry_full_pt", "emotion_decay_min"] as const) {
      stage[field] = num(issues, rawStage, "stage", field, positive, "a finite number > 0");
    }
    stage.carry_extra_ms = num(
      issues,
      rawStage,
      "stage",
      "carry_extra_ms",
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
    stage.entry_families = namedObjects<EntryFamily>(
      issues,
      rawStage,
      "entry_families",
      ["plain"],
      (family, path) => ({
        emotions: strings(issues, family, path, "emotions") as string[],
        clips: strings(issues, family, path, "clips") as string[],
      }),
    ) as StageConfig["entry_families"] | undefined;
    stage.edge_entries = namedObjects<EdgeEntry>(
      issues,
      rawStage,
      "edge_entries",
      [],
      (entry, path) => ({
        inset: num(issues, entry, path, "inset", unit, "a finite number in [0, 1]") as number,
        ...(entry.play_ms !== undefined && {
          play_ms: num(issues, entry, path, "play_ms", positive, "a finite number > 0"),
        }),
      }),
    );
    stage.edge_release_ms = num(
      issues,
      rawStage,
      "stage",
      "edge_release_ms",
      positive,
      "a finite number > 0",
    );
    stage.pickup_hold_ms = num(
      issues,
      rawStage,
      "stage",
      "pickup_hold_ms",
      nonNegative,
      "a finite number >= 0",
    );
  }
  return stage;
}
