import type { SourcesConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

export function validateSources(file: string, raw: unknown): SourcesConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const obj: Record<string, unknown> = raw;

  function validatePresenceBlock(blockKey: string): number {
    const block = obj[blockKey];
    if (!isObject(block)) {
      issues.push(`${blockKey}는 객체여야 함 (받음: ${JSON.stringify(block)})`);
      return 0;
    }
    const idle = block.present_max_idle_ms;
    if (typeof idle !== "number" || !Number.isFinite(idle) || idle <= 0) {
      issues.push(
        `${blockKey}.present_max_idle_ms는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(idle)})`,
      );
      return 0;
    }
    if (idle < 10000) {
      issues.push(
        `${blockKey}.present_max_idle_ms는 ≥ 10000ms (≥ 2 nominal ~5s ticks)여야 함 (받음: ${JSON.stringify(idle)})`,
      );
      return 0;
    }
    return idle;
  }

  const proactive_idle = validatePresenceBlock("proactive");
  const schedule_idle = validatePresenceBlock("schedule");

  assertValid(file, issues);
  return {
    proactive: { present_max_idle_ms: proactive_idle },
    schedule: { present_max_idle_ms: schedule_idle },
  };
}
