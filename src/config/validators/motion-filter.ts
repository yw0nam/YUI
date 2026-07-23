import type { MotionFilterConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateMotionFilter(file: string, raw: unknown): MotionFilterConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const value = raw.blocked_tags;
  let blocked_tags: string[] = [];

  if (value !== undefined) {
    if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
      issues.push("blocked_tags는 문자열 배열이어야 함");
    } else {
      blocked_tags = value as string[];
    }
  }

  assertValid(file, issues);
  return { blocked_tags };
}
