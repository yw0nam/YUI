import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMOTION_IDS, validateEmotionRegistry } from "./emotion-registry";
import { ConfigError } from "./shared";

const FILE = "emotion_registry.json";

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateEmotionRegistry(FILE, raw);
    expect.unreachable("validateEmotionRegistry should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    const err = e as ConfigError;
    expect(err.file).toBe(FILE);
    expect(
      err.issues.some((i) => i.includes(fragment)),
      err.issues.join("; "),
    ).toBe(true);
  }
}

describe("validateEmotionRegistry — happy path", () => {
  it("accepts a single valid entry", () => {
    const out = validateEmotionRegistry(FILE, {
      neutral: { vrm_expression: "neutral", fallback: "neutral" },
    });
    expect(out).toEqual({ neutral: { vrm_expression: "neutral", fallback: "neutral" } });
  });

  it("accepts all 10 enum emotion ids", () => {
    const raw = Object.fromEntries(
      [...EMOTION_IDS].map((id) => [id, { vrm_expression: id, fallback: "neutral" }]),
    );
    const out = validateEmotionRegistry(FILE, raw);
    expect(Object.keys(out)).toHaveLength(EMOTION_IDS.size);
  });

  it("accepts an empty registry (no minimum-entries requirement)", () => {
    const out = validateEmotionRegistry(FILE, {});
    expect(out).toEqual({});
  });
});

describe("validateEmotionRegistry — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });
});

describe("validateEmotionRegistry — key/entry validation", () => {
  it("rejects an id outside the emotion enum", () => {
    expectIssue(
      { bogus: { vrm_expression: "x", fallback: "neutral" } },
      "bogus: 알 수 없는 emotion id",
    );
  });

  it("rejects a non-object entry", () => {
    expectIssue({ happy: "not-an-object" }, "happy: 항목이 객체가 아님");
  });

  it("rejects a non-string vrm_expression", () => {
    expectIssue({ happy: { vrm_expression: 1, fallback: "neutral" } }, "vrm_expression은 문자열");
  });

  it("rejects a non-string fallback", () => {
    expectIssue({ happy: { vrm_expression: "happy", fallback: 1 } }, "fallback은 문자열");
  });

  it("accumulates issues across multiple bad entries", () => {
    try {
      validateEmotionRegistry(FILE, {
        bogus: { vrm_expression: "x", fallback: "neutral" },
        happy: { vrm_expression: "happy" },
      });
      expect.unreachable("validateEmotionRegistry should have thrown");
    } catch (e) {
      const err = e as ConfigError;
      expect(err.issues.length).toBe(2);
    }
  });
});

describe("configs/emotion_registry.json — the shipped registry", () => {
  const shipped = validateEmotionRegistry(
    FILE,
    JSON.parse(readFileSync(resolve(process.cwd(), "configs", FILE), "utf-8")),
  );

  it("covers exactly the emotion enum", () => {
    expect(Object.keys(shipped).sort()).toEqual([...EMOTION_IDS].sort());
  });

  it("every fallback is a known emotion id", () => {
    for (const [id, entry] of Object.entries(shipped)) {
      expect([...EMOTION_IDS], `${id}.fallback`).toContain(entry.fallback);
    }
  });
});
