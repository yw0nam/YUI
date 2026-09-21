import type { HotkeysConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateHotkeys(file: string, raw: unknown): HotkeysConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];

  const v = raw.summon_global;
  let summon_global = "";
  if (v === undefined || v === "") {
    // Missing key / empty string = disabled.
    summon_global = "";
  } else if (typeof v !== "string") {
    issues.push(`summon_global must be a string (got: ${JSON.stringify(v)})`);
  } else {
    // Accelerator syntax validation is the plugin/OS's job at registration time — pass here (fail-soft).
    summon_global = v;
  }

  assertValid(file, issues);
  return { summon_global };
}
