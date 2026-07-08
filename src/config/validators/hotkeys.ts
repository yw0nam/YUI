import type { HotkeysConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateHotkeys(file: string, raw: unknown): HotkeysConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  const v = raw.summon_global;
  let summon_global = "";
  if (v === undefined || v === "") {
    // 키 없음/빈 문자열 = 비활성.
    summon_global = "";
  } else if (typeof v !== "string") {
    issues.push(`summon_global은 문자열이어야 함 (받음: ${JSON.stringify(v)})`);
  } else {
    // accelerator 문법 판정은 등록 시점의 플러그인/OS 소관 — 여기서는 통과(fail-soft).
    summon_global = v;
  }

  assertValid(file, issues);
  return { summon_global };
}
