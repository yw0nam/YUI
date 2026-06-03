import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest는 프로젝트 루트에서 실행되므로 cwd 기준으로 아티팩트를 읽는다.
const read = (rel: string): any =>
  JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf-8"));

// docs/contract.md §1 — canonical emotion vocabulary. 테스트의 단일 기준점.
const EMOTION_IDS = [
  "neutral", "happy", "angry", "sad", "relaxed", "surprised",
  "thinking", "curious", "sleepy", "embarrassed",
] as const;
const sorted = (a: readonly string[]) => [...a].sort();

describe("express tool spec (configs/express_tool.schema.json)", () => {
  const spec = read("configs/express_tool.schema.json");

  it("is the express function with optional, non-strict args", () => {
    expect(spec.type).toBe("function");
    expect(spec.name).toBe("express");
    // strict 모드는 모든 property를 required로 강제 → optional 의미(D-EXPRESS-OPTIONAL)와 충돌.
    expect(spec.strict).toBe(false);
    expect(spec.parameters.additionalProperties).toBe(false);
    expect(spec.parameters.required).toEqual([]); // express 호출 자체가 매 턴 optional
  });

  it("emotion.id enum matches the §1 vocabulary exactly", () => {
    const enumIds: string[] = spec.parameters.properties.emotion.properties.id.enum;
    expect(sorted(enumIds)).toEqual(sorted(EMOTION_IDS));
  });

  it("emotion/motion objects require only id", () => {
    expect(spec.parameters.properties.emotion.required).toEqual(["id"]);
    expect(spec.parameters.properties.motion.required).toEqual(["id"]);
  });

  it("does not carry speech_text (D-SPEECH: 발화는 별도 텍스트 스트림)", () => {
    expect(spec.parameters.properties).not.toHaveProperty("speech_text");
  });
});

describe("emotion vocabulary consistency across artifacts", () => {
  it("emotion_registry.json covers exactly the §1 enum", () => {
    const reg = read("configs/emotion_registry.json");
    expect(sorted(Object.keys(reg))).toEqual(sorted(EMOTION_IDS));
  });

  it("express enum and emotion_registry keys agree (drift guard)", () => {
    const enumIds: string[] =
      read("configs/express_tool.schema.json").parameters.properties.emotion.properties.id.enum;
    const regKeys = Object.keys(read("configs/emotion_registry.json"));
    expect(sorted(enumIds)).toEqual(sorted(regKeys));
  });

  it("every emotion_registry entry has vrm_expression + fallback, fallback ends at a known id", () => {
    const reg = read("configs/emotion_registry.json");
    for (const [id, entry] of Object.entries<any>(reg)) {
      expect(entry.vrm_expression, id).toBeTypeOf("string");
      expect(EMOTION_IDS, `${id}.fallback`).toContain(entry.fallback);
    }
  });
});
