import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from the project root, so artifacts are read relative to cwd.
const read = (rel: string): any => JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf-8"));

// canonical emotion vocabulary — this test is the single source of truth.
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
