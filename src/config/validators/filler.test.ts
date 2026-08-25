import { describe, expect, it } from "vitest";
import { validateFiller, validateFillerTier, validateFillerToolTier } from "./filler";
import { ConfigError } from "./shared";

const FILE = "filler.json";

function basePool(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    first: ["うーん…"],
    repeat: ["ええと…"],
    long_wait: ["ちょっと時間かかってるね…"],
    tool: { _default: ["調べてみるね…"] },
    timeout: ["ごめん、諦めちゃった。"],
    unreachable: ["今つながらないみたい。"],
    ...overrides,
  };
}

function baseRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gap_ms: 1000,
    gap_jitter_ms: 300,
    max_repeats: 3,
    gap_growth: 2,
    pools: {
      ja: basePool(),
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
        ja: basePool(),
        en: basePool({ first: ["Hmm"], repeat: ["Well"] }),
        ko: basePool({ first: ["음"], repeat: ["글쎄"] }),
      },
    });
    const out = validateFiller(FILE, raw);
    expect(Object.keys(out.pools)).toEqual(["ja", "en", "ko"]);
  });

  it("accepts an empty list tier and an empty tool object (zero-length is valid)", () => {
    const raw = baseRaw({
      pools: {
        ja: basePool({ first: [], repeat: [], long_wait: [], tool: {}, timeout: [], unreachable: [] }),
      },
    });
    const out = validateFiller(FILE, raw);
    expect(out.pools.ja).toEqual({
      first: [],
      repeat: [],
      long_wait: [],
      tool: {},
      timeout: [],
      unreachable: [],
    });
  });
});

describe("validateFiller — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });
});

describe("validateFiller — gap_ms / gap_jitter_ms / max_repeats / gap_growth", () => {
  it("rejects a negative gap_ms", () => {
    expectIssue(baseRaw({ gap_ms: -1 }), "gap_ms는 0 이상 유한 number여야 함");
  });

  it("rejects a non-number gap_jitter_ms", () => {
    expectIssue(baseRaw({ gap_jitter_ms: "300" }), "gap_jitter_ms는 0 이상 유한 number여야 함");
  });

  it("rejects a non-finite gap_ms", () => {
    expectIssue(baseRaw({ gap_ms: Number.NaN }), "gap_ms는 0 이상 유한 number여야 함");
  });

  it("rejects a negative max_repeats", () => {
    expectIssue(baseRaw({ max_repeats: -1 }), "max_repeats는 0 이상 정수여야 함");
  });

  it("rejects a non-integer max_repeats", () => {
    expectIssue(baseRaw({ max_repeats: 1.5 }), "max_repeats는 0 이상 정수여야 함");
  });

  it("rejects a gap_growth below 1", () => {
    expectIssue(baseRaw({ gap_growth: 0.5 }), "gap_growth는 1 이상 유한 number여야 함");
  });

  it("rejects a non-finite gap_growth", () => {
    expectIssue(baseRaw({ gap_growth: Number.NaN }), "gap_growth는 1 이상 유한 number여야 함");
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
    expectIssue(baseRaw({ pools: { fr: basePool() } }), "pools의 알 수 없는 키");
  });

  it("rejects a pool entry that isn't an object", () => {
    expectIssue(baseRaw({ pools: { ja: "nope" } }), "pools.ja는 객체여야 함");
  });

  it("rejects a first tier that isn't an array", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ first: "x" }) } }),
      "pools.ja.first는 배열이어야 함",
    );
  });

  it("rejects a repeat tier with non-string entries", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ repeat: [1, 2] }) } }),
      "pools.ja.repeat[0]는 문자열이어야 함",
    );
  });

  it("rejects a missing long_wait tier — config is ours, tiers must be present", () => {
    const pool = basePool();
    delete pool.long_wait;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.long_wait는 배열이어야 함");
  });

  it("rejects a missing timeout tier", () => {
    const pool = basePool();
    delete pool.timeout;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.timeout는 배열이어야 함");
  });

  it("rejects a missing unreachable tier", () => {
    const pool = basePool();
    delete pool.unreachable;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.unreachable는 배열이어야 함");
  });

  it("rejects a missing tool tier", () => {
    const pool = basePool();
    delete pool.tool;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.tool는 객체여야 함");
  });

  it("rejects a tool tier that isn't an object", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ tool: ["nope"] }) } }),
      "pools.ja.tool는 객체여야 함",
    );
  });

  it("rejects a tool tier whose value isn't a string array", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ tool: { _default: [1] } }) } }),
      "pools.ja.tool._default[0]는 문자열이어야 함",
    );
  });

  it("accepts multiple tool keys including _default", () => {
    const out = validateFiller(
      FILE,
      baseRaw({
        pools: {
          ja: basePool({ tool: { _default: ["a"], terminal: ["b"], web_search: ["c"] } }),
        },
      }),
    );
    expect(out.pools.ja?.tool).toEqual({ _default: ["a"], terminal: ["b"], web_search: ["c"] });
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

describe("validateFillerToolTier — unit", () => {
  it("returns the dict unchanged when every value is a string array", () => {
    const issues: string[] = [];
    expect(validateFillerToolTier(issues, { _default: ["a"], terminal: ["b"] }, "x")).toEqual({
      _default: ["a"],
      terminal: ["b"],
    });
    expect(issues).toEqual([]);
  });

  it("records an issue and returns {} when not an object", () => {
    const issues: string[] = [];
    expect(validateFillerToolTier(issues, "nope", "x")).toEqual({});
    expect(issues).toEqual(['x는 객체여야 함 (받음: "nope")']);
  });

  it("records per-key issues and returns {} when any value isn't a string array", () => {
    const issues: string[] = [];
    expect(validateFillerToolTier(issues, { terminal: [1] }, "x")).toEqual({});
    expect(issues).toEqual(["x.terminal[0]는 문자열이어야 함 (받음: 1)"]);
  });
});
