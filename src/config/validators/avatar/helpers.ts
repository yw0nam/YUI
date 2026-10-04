import type { GestureCueConfig } from "../../load";

/** What every section validator receives besides its raw input. */
export interface SectionContext {
  issues: string[];
}

/** obj[key] when it is a finite number `ok` accepts; records `path.key` and returns undefined otherwise. */
export const num = (
  issues: string[],
  obj: Record<string, unknown>,
  path: string,
  key: string,
  ok: (v: number) => boolean,
  expected: string,
): number | undefined => {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) {
    issues.push(`${path}.${key} must be ${expected} (got: ${JSON.stringify(value)})`);
    return undefined;
  }
  return value;
};

/** Same for an integer. */
export const int = (
  issues: string[],
  obj: Record<string, unknown>,
  path: string,
  key: string,
  ok: (v: number) => boolean,
  expected: string,
): number | undefined => {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || !ok(value)) {
    issues.push(`${path}.${key} must be ${expected} (got: ${JSON.stringify(value)})`);
    return undefined;
  }
  return value;
};

/** obj[key] when it is a non-empty string; records `path.key` and returns undefined otherwise. */
export const str = (
  issues: string[],
  obj: Record<string, unknown>,
  path: string,
  key: string,
): string | undefined => {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    issues.push(`${path}.${key} must be a non-empty string (got: ${JSON.stringify(value)})`);
    return undefined;
  }
  return value;
};

/** Records an issue when both bounds are present and the minimum exceeds the maximum. */
export const requireOrder = (
  issues: string[],
  path: string,
  minKey: string,
  min: number | undefined,
  maxKey: string,
  max: number | undefined,
): void => {
  if (min === undefined || max === undefined || min <= max) return;
  issues.push(`${path}.${minKey} must be <= ${path}.${maxKey} (got: ${min} > ${max})`);
};

/** One `{ label, context? }` cue. label is required; context stays optional user intent. */
export const cue = (
  issues: string[],
  obj: Record<string, unknown>,
  path: string,
): GestureCueConfig | undefined => {
  const label = str(issues, obj, path, "label");
  const context = obj.context;
  if (context !== undefined && (typeof context !== "string" || context.length === 0)) {
    issues.push(`${path}.context must be a non-empty string (got: ${JSON.stringify(context)})`);
    return undefined;
  }
  if (label === undefined) return undefined;
  return { label, ...(context !== undefined ? { context: context as string } : {}) };
};

export const positive = (v: number): boolean => v > 0;
export const nonNegative = (v: number): boolean => v >= 0;
export const unit = (v: number): boolean => v >= 0 && v <= 1;

/** Records an issue for every key of `obj` outside `allowed`. */
export function rejectUnknownKeys(
  issues: string[],
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(`${path}.${key} is an unknown key`);
  }
}
