import type { HotkeysConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateHotkeys(file: string, raw: unknown): HotkeysConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  const v = raw.summon_global;
  let summon_global = "";
  if (v === undefined || v === "") {
    // Missing key / empty string = disabled.
    summon_global = "";
  } else if (typeof v !== "string") {
    issues.push(`summon_global은 문자열이어야 함 (받음: ${JSON.stringify(v)})`);
  } else {
    // Accelerator syntax validation is the plugin/OS's job at registration time — pass here (fail-soft).
    summon_global = v;
  }

  assertValid(file, issues);
  return { summon_global };
}
