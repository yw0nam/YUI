import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest는 프로젝트 루트에서 실행되므로 cwd 기준으로 아티팩트를 읽는다.
const read = (rel: string): any => JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf-8"));

// docs/contract.md §1 — canonical emotion vocabulary. 테스트의 단일 기준점.
const EMOTION_IDS = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "thinking",
  "curious",
  "sleepy",
  "embarrassed",
] as const;
const sorted = (a: readonly string[]) => [...a].sort();

describe("emotion vocabulary consistency across artifacts", () => {
  it("emotion_registry.json covers exactly the §1 enum", () => {
    const reg = read("configs/emotion_registry.json");
    expect(sorted(Object.keys(reg))).toEqual(sorted(EMOTION_IDS));
  });

  it("every emotion_registry entry has vrm_expression + fallback, fallback ends at a known id", () => {
    const reg = read("configs/emotion_registry.json");
    for (const [id, entry] of Object.entries<any>(reg)) {
      expect(entry.vrm_expression, id).toBeTypeOf("string");
      expect(EMOTION_IDS, `${id}.fallback`).toContain(entry.fallback);
    }
  });
});
