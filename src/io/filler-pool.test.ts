import { describe, expect, it } from "vitest";
import type { FillerConfig } from "../config/load";
import { effectiveFillerPool, fillerSubmissions, phraseSentences } from "./filler-pool";
import type { FillerSettings } from "./filler-settings";

const cfg: FillerConfig = {
  gap_ms: 5000,
  gap_jitter_ms: 500,
  pools: {
    ja: { first: ["うーん…", "ええと…"], repeat: ["まだ考えてます"] },
    en: { first: ["Hmm..."], repeat: ["Still thinking..."] },
    ko: { first: ["음…"], repeat: [] },
  },
};

function settings(over: Partial<FillerSettings> = {}): FillerSettings {
  return { enabled: true, language: "ja", customPools: {}, ...over };
}

describe("effectiveFillerPool", () => {
  it("returns {first:[],repeat:[]} when disabled", () => {
    expect(effectiveFillerPool(settings({ enabled: false }), cfg)).toEqual({
      first: [],
      repeat: [],
    });
  });

  it("falls back to config pool for the active language", () => {
    expect(effectiveFillerPool(settings({ language: "ja" }), cfg)).toEqual({
      first: ["うーん…", "ええと…"],
      repeat: ["まだ考えてます"],
    });
    expect(effectiveFillerPool(settings({ language: "en" }), cfg)).toEqual({
      first: ["Hmm..."],
      repeat: ["Still thinking..."],
    });
  });

  it("prefers custom.first over config.first if custom.first has ≥1 entry", () => {
    const s = settings({
      language: "ja",
      customPools: { ja: { first: ["やあ"], repeat: [] } },
    });
    const result = effectiveFillerPool(s, cfg);
    expect(result.first).toEqual(["やあ"]);
    // repeat falls back to config because custom.repeat is empty
    expect(result.repeat).toEqual(["まだ考えてます"]);
  });

  it("prefers custom.repeat over config.repeat if custom.repeat has ≥1 entry", () => {
    const s = settings({
      language: "ja",
      customPools: { ja: { first: [], repeat: ["カスタムリピート"] } },
    });
    const result = effectiveFillerPool(s, cfg);
    // first falls back to config because custom.first is empty
    expect(result.first).toEqual(["うーん…", "ええと…"]);
    expect(result.repeat).toEqual(["カスタムリピート"]);
  });

  it("partial custom (only first set) falls back to config for repeat independently", () => {
    const s = settings({
      language: "en",
      customPools: { en: { first: ["Custom first"], repeat: [] } },
    });
    const result = effectiveFillerPool(s, cfg);
    expect(result.first).toEqual(["Custom first"]);
    expect(result.repeat).toEqual(["Still thinking..."]);
  });

  it("returns {first:[],repeat:[]} when neither custom nor config has the language", () => {
    const bare: FillerConfig = { gap_ms: 5000, gap_jitter_ms: 500, pools: {} };
    expect(effectiveFillerPool(settings({ language: "ko" }), bare)).toEqual({
      first: [],
      repeat: [],
    });
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
  it("unions the sentences of both pools", () => {
    expect(fillerSubmissions({ first: ["うーん。"], repeat: ["まだ考えてます。"] })).toEqual(
      new Set(["うーん。", "まだ考えてます。"]),
    );
  });

  it("collapses a phrase shared by both pools into one submission", () => {
    expect(fillerSubmissions({ first: ["うーん。"], repeat: ["うーん。"] })).toEqual(
      new Set(["うーん。"]),
    );
  });
});
