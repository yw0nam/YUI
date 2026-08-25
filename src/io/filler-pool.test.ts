import { describe, expect, it } from "vitest";
import type { FillerConfig, FillerPool } from "../config/load";
import { effectiveFillerPool, fillerSubmissions, phraseSentences } from "./filler-pool";
import type { FillerSettings } from "./filler-settings";

function pool(overrides: Partial<FillerPool> = {}): FillerPool {
  return {
    first: [],
    repeat: [],
    long_wait: [],
    tool: {},
    timeout: [],
    unreachable: [],
    ...overrides,
  };
}

const cfg: FillerConfig = {
  gap_ms: 5000,
  gap_jitter_ms: 500,
  max_repeats: 3,
  gap_growth: 2,
  long_wait_ms: 40000,
  pools: {
    ja: pool({
      first: ["うーん…", "ええと…"],
      repeat: ["まだ考えてます"],
      long_wait: ["まだかかりそう"],
      tool: { _default: ["調べてみるね"], terminal: ["動かすね"] },
      timeout: ["諦めちゃった"],
      unreachable: ["つながらないみたい"],
    }),
    en: pool({ first: ["Hmm..."], repeat: ["Still thinking..."] }),
    ko: pool({ first: ["음…"], repeat: [] }),
  },
};

function settings(over: Partial<FillerSettings> = {}): FillerSettings {
  return { enabled: true, language: "ja", customPools: {}, ...over };
}

describe("effectiveFillerPool", () => {
  it("returns every tier empty when disabled", () => {
    expect(effectiveFillerPool(settings({ enabled: false }), cfg)).toEqual(pool());
  });

  it("falls back to config pool for the active language", () => {
    expect(effectiveFillerPool(settings({ language: "ja" }), cfg)).toEqual(cfg.pools.ja);
    expect(effectiveFillerPool(settings({ language: "en" }), cfg)).toEqual(cfg.pools.en);
  });

  it("prefers custom.first over config.first if custom.first has ≥1 entry", () => {
    const s = settings({
      language: "ja",
      customPools: { ja: { first: ["やあ"] } },
    });
    const result = effectiveFillerPool(s, cfg);
    expect(result.first).toEqual(["やあ"]);
    // repeat falls back to config because custom.repeat is absent
    expect(result.repeat).toEqual(["まだ考えてます"]);
  });

  it("prefers custom.repeat over config.repeat if custom.repeat has ≥1 entry", () => {
    const s = settings({
      language: "ja",
      customPools: { ja: { repeat: ["カスタムリピート"] } },
    });
    const result = effectiveFillerPool(s, cfg);
    // first falls back to config because custom.first is absent
    expect(result.first).toEqual(["うーん…", "ええと…"]);
    expect(result.repeat).toEqual(["カスタムリピート"]);
  });

  it("resolves long_wait/timeout/unreachable the same way as first/repeat", () => {
    const s = settings({
      language: "ja",
      customPools: { ja: { long_wait: ["カスタム待ち"], timeout: ["カスタムタイムアウト"] } },
    });
    const result = effectiveFillerPool(s, cfg);
    expect(result.long_wait).toEqual(["カスタム待ち"]);
    expect(result.timeout).toEqual(["カスタムタイムアウト"]);
    // unreachable falls back to config because it's absent from the custom pool
    expect(result.unreachable).toEqual(["つながらないみたい"]);
  });

  it("prefers custom.tool over config.tool when custom.tool has ≥1 key", () => {
    const s = settings({
      language: "ja",
      customPools: { ja: { tool: { _default: ["カスタムツール"] } } },
    });
    expect(effectiveFillerPool(s, cfg).tool).toEqual({ _default: ["カスタムツール"] });
  });

  it("falls back to config.tool when custom.tool is empty or absent", () => {
    const s = settings({ language: "ja", customPools: { ja: { tool: {} } } });
    expect(effectiveFillerPool(s, cfg).tool).toEqual({
      _default: ["調べてみるね"],
      terminal: ["動かすね"],
    });
  });

  it("partial custom (only first set) falls back to config for repeat independently", () => {
    const s = settings({
      language: "en",
      customPools: { en: { first: ["Custom first"] } },
    });
    const result = effectiveFillerPool(s, cfg);
    expect(result.first).toEqual(["Custom first"]);
    expect(result.repeat).toEqual(["Still thinking..."]);
  });

  it("returns every tier empty when neither custom nor config has the language", () => {
    const bare: FillerConfig = {
      gap_ms: 5000,
      gap_jitter_ms: 500,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: {},
    };
    expect(effectiveFillerPool(settings({ language: "ko" }), bare)).toEqual(pool());
  });

  it("config pool with empty repeat returns empty repeat", () => {
    const result = effectiveFillerPool(settings({ language: "ko" }), cfg);
    expect(result.first).toEqual(["음…"]);
    expect(result.repeat).toEqual([]);
  });
});

describe("phraseSentences", () => {
  it("strips the emoji a phrase carries around its text", () => {
    expect(phraseSentences("🥺少し…⏸️考えさせて。")).toEqual(["少し…考えさせて。"]);
  });

  it("drops a trailing emoji the stripper holds back until flush", () => {
    expect(phraseSentences("ちょっと待ってね。😒")).toEqual(["ちょっと待ってね。"]);
  });

  it("returns no sentence for an emoji-only phrase", () => {
    expect(phraseSentences("🤔🥺")).toEqual([]);
  });

  it("splits a phrase on an embedded newline", () => {
    expect(phraseSentences("うーん\nちょっと待ってね")).toEqual(["うーん", "ちょっと待ってね"]);
  });

  it("splits a phrase into every sentence it terminates", () => {
    expect(phraseSentences("うーん🤔。ちょっと待ってね😒。")).toEqual([
      "うーん。",
      "ちょっと待ってね。",
    ]);
  });
});

describe("fillerSubmissions", () => {
  it("unions the sentences of first and repeat", () => {
    expect(fillerSubmissions(pool({ first: ["うーん。"], repeat: ["まだ考えてます。"] }))).toEqual(
      new Set(["うーん。", "まだ考えてます。"]),
    );
  });

  it("collapses a phrase shared by both pools into one submission", () => {
    expect(fillerSubmissions(pool({ first: ["うーん。"], repeat: ["うーん。"] }))).toEqual(
      new Set(["うーん。"]),
    );
  });

  it("includes long_wait, timeout, and unreachable", () => {
    const p = pool({
      long_wait: ["まだかかりそう。"],
      timeout: ["諦めちゃった。"],
      unreachable: ["つながらないみたい。"],
    });
    expect(fillerSubmissions(p)).toEqual(
      new Set(["まだかかりそう。", "諦めちゃった。", "つながらないみたい。"]),
    );
  });

  it("includes every tool phrase across every tool_id", () => {
    const p = pool({ tool: { _default: ["調べてみるね。"], terminal: ["動かすね。"] } });
    expect(fillerSubmissions(p)).toEqual(new Set(["調べてみるね。", "動かすね。"]));
  });
});
