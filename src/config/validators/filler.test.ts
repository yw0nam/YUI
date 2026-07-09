import { describe, expect, it } from "vitest";
import { validateFiller, validateFillerTier } from "./filler";
import { ConfigError } from "./shared";

const FILE = "filler.json";

function baseRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gap_ms: 1000,
    gap_jitter_ms: 300,
    pools: {
      ja: { first: ["うーん…"], repeat: ["ええと…"] },
    },
    ...overrides,
  };
}

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateFiller(FILE, raw);
    expect.unreachable("validateFiller should have thrown");
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

describe("validateFiller — happy path", () => {
  it("accepts a single-language pool", () => {
    const out = validateFiller(FILE, baseRaw());
    expect(out).toEqual(baseRaw());
  });

  it("accepts all three languages", () => {
    const raw = baseRaw({
      pools: {
        ja: { first: ["う"], repeat: ["え"] },
        en: { first: ["Hmm"], repeat: ["Well"] },
        ko: { first: ["음"], repeat: ["글쎄"] },
      },
    });
    const out = validateFiller(FILE, raw);
    expect(Object.keys(out.pools)).toEqual(["ja", "en", "ko"]);
  });

  it("accepts an empty first/repeat tier (zero-length arrays are valid)", () => {
    const raw = baseRaw({ pools: { ja: { first: [], repeat: [] } } });
    const out = validateFiller(FILE, raw);
    expect(out.pools.ja).toEqual({ first: [], repeat: [] });
  });
});

describe("validateFiller — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });
});

describe("validateFiller — gap_ms / gap_jitter_ms", () => {
  it("rejects a negative gap_ms", () => {
    expectIssue(baseRaw({ gap_ms: -1 }), "gap_ms는 0 이상 유한 number여야 함");
  });

  it("rejects a non-number gap_jitter_ms", () => {
    expectIssue(baseRaw({ gap_jitter_ms: "300" }), "gap_jitter_ms는 0 이상 유한 number여야 함");
  });

  it("rejects a non-finite gap_ms", () => {
    expectIssue(baseRaw({ gap_ms: Number.NaN }), "gap_ms는 0 이상 유한 number여야 함");
  });
});

describe("validateFiller — pools", () => {
  it("rejects a non-object pools", () => {
    expectIssue(baseRaw({ pools: "nope" }), "pools는 객체여야 함");
  });

  it("rejects an empty pools object", () => {
    expectIssue(baseRaw({ pools: {} }), "pools는 최소 한 개의 언어(ja | en | ko)를 포함해야 함");
  });

  it("rejects an unknown language key", () => {
    expectIssue(
      baseRaw({ pools: { fr: { first: ["x"], repeat: ["y"] } } }),
      "pools의 알 수 없는 키",
    );
  });

  it("rejects a pool entry that isn't an object", () => {
    expectIssue(baseRaw({ pools: { ja: "nope" } }), "pools.ja는 {first, repeat} 객체여야 함");
  });

  it("rejects a first tier that isn't an array", () => {
    expectIssue(
      baseRaw({ pools: { ja: { first: "x", repeat: [] } } }),
      "pools.ja.first는 배열이어야 함",
    );
  });

  it("rejects a repeat tier with non-string entries", () => {
    expectIssue(
      baseRaw({ pools: { ja: { first: [], repeat: [1, 2] } } }),
      "pools.ja.repeat[0]는 문자열이어야 함",
    );
  });
});

describe("validateFillerTier — unit", () => {
  it("returns the array unchanged when all entries are strings", () => {
    const issues: string[] = [];
    expect(validateFillerTier(issues, ["a", "b"], "x")).toEqual(["a", "b"]);
    expect(issues).toEqual([]);
  });

  it("records an issue and returns [] when not an array", () => {
    const issues: string[] = [];
    expect(validateFillerTier(issues, "nope", "x")).toEqual([]);
    expect(issues).toEqual(['x는 배열이어야 함 (받음: "nope")']);
  });

  it("records per-index issues and returns [] when any entry isn't a string", () => {
    const issues: string[] = [];
    expect(validateFillerTier(issues, ["a", 1, "c"], "x")).toEqual([]);
    expect(issues).toEqual(["x[1]는 문자열이어야 함 (받음: 1)"]);
  });
});
