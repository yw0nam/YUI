import { describe, expect, it } from "vitest";
import { validateFiller } from "./filler";
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
    long_wait_ms: 40000,
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
        ja: basePool({
          first: [],
          repeat: [],
          long_wait: [],
          tool: {},
          timeout: [],
          unreachable: [],
        }),
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
    expectIssue([], "not an object");
    expectIssue("x", "not an object");
    expectIssue(null, "not an object");
  });
});

describe("validateFiller — gap_ms / gap_jitter_ms / max_repeats / gap_growth / long_wait_ms", () => {
  it("rejects a negative gap_ms", () => {
    expectIssue(baseRaw({ gap_ms: -1 }), "gap_ms must be a finite number >= 0");
  });

  it("rejects a non-number gap_jitter_ms", () => {
    expectIssue(baseRaw({ gap_jitter_ms: "300" }), "gap_jitter_ms must be a finite number >= 0");
  });

  it("rejects a non-finite gap_ms", () => {
    expectIssue(baseRaw({ gap_ms: Number.NaN }), "gap_ms must be a finite number >= 0");
  });

  it("rejects a negative max_repeats", () => {
    expectIssue(baseRaw({ max_repeats: -1 }), "max_repeats must be an integer >= 0");
  });

  it("rejects a non-integer max_repeats", () => {
    expectIssue(baseRaw({ max_repeats: 1.5 }), "max_repeats must be an integer >= 0");
  });

  it("rejects a gap_growth below 1", () => {
    expectIssue(baseRaw({ gap_growth: 0.5 }), "gap_growth must be a finite number >= 1");
  });

  it("rejects a non-finite gap_growth", () => {
    expectIssue(baseRaw({ gap_growth: Number.NaN }), "gap_growth must be a finite number >= 1");
  });

  it("rejects a negative long_wait_ms", () => {
    expectIssue(baseRaw({ long_wait_ms: -1 }), "long_wait_ms must be a finite number >= 0");
  });

  it("rejects a non-finite long_wait_ms", () => {
    expectIssue(baseRaw({ long_wait_ms: Number.NaN }), "long_wait_ms must be a finite number >= 0");
  });

  it("accepts long_wait_ms and preserves it", () => {
    const out = validateFiller(FILE, baseRaw({ long_wait_ms: 40000 }));
    expect(out.long_wait_ms).toBe(40000);
  });
});

describe("validateFiller — pools", () => {
  it("rejects a non-object pools", () => {
    expectIssue(baseRaw({ pools: "nope" }), "pools must be an object");
  });

  it("rejects an empty pools object", () => {
    expectIssue(baseRaw({ pools: {} }), "pools must contain at least one language (ja | en | ko)");
  });

  it("rejects an unknown language key", () => {
    expectIssue(baseRaw({ pools: { fr: basePool() } }), "pools.fr is an unknown key");
  });

  it("rejects a pool entry that isn't an object", () => {
    expectIssue(baseRaw({ pools: { ja: "nope" } }), "pools.ja must be an object");
  });

  it("rejects a first tier that isn't an array", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ first: "x" }) } }),
      "pools.ja.first must be an array",
    );
  });

  it("rejects a repeat tier with non-string entries", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ repeat: [1, 2] }) } }),
      "pools.ja.repeat[0] must be a string",
    );
  });

  it("rejects a missing long_wait tier — config is ours, tiers must be present", () => {
    const pool = basePool();
    delete pool.long_wait;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.long_wait must be an array");
  });

  it("rejects a missing timeout tier", () => {
    const pool = basePool();
    delete pool.timeout;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.timeout must be an array");
  });

  it("rejects a missing unreachable tier", () => {
    const pool = basePool();
    delete pool.unreachable;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.unreachable must be an array");
  });

  it("rejects a missing tool tier", () => {
    const pool = basePool();
    delete pool.tool;
    expectIssue(baseRaw({ pools: { ja: pool } }), "pools.ja.tool must be an object");
  });

  it("rejects a tool tier that isn't an object", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ tool: ["nope"] }) } }),
      "pools.ja.tool must be an object",
    );
  });

  it("rejects a tool tier whose value isn't a string array", () => {
    expectIssue(
      baseRaw({ pools: { ja: basePool({ tool: { _default: [1] } }) } }),
      "pools.ja.tool._default[0] must be a string",
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
