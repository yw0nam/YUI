import { describe, expect, it } from "vitest";
import type { FillerConfig } from "../config/load";
import { effectiveFillerPool } from "./filler-pool";
import type { FillerSettings } from "./filler-settings";

const cfg: FillerConfig = {
  threshold_ms: 500,
  pools: { ja: ["うーん…", "ええと…"], en: ["Hmm..."], ko: ["음…"] },
};

function settings(over: Partial<FillerSettings> = {}): FillerSettings {
  return { enabled: true, language: "ja", customPools: {}, ...over };
}

describe("effectiveFillerPool", () => {
  it("returns [] when disabled", () => {
    expect(effectiveFillerPool(settings({ enabled: false }), cfg)).toEqual([]);
  });

  it("falls back to config pool for the active language", () => {
    expect(effectiveFillerPool(settings({ language: "ja" }), cfg)).toEqual(["うーん…", "ええと…"]);
    expect(effectiveFillerPool(settings({ language: "en" }), cfg)).toEqual(["Hmm..."]);
  });

  it("prefers a non-empty custom pool over the config pool", () => {
    const s = settings({ language: "ja", customPools: { ja: ["やあ"] } });
    expect(effectiveFillerPool(s, cfg)).toEqual(["やあ"]);
  });

  it("ignores an empty custom pool and uses the config pool", () => {
    const s = settings({ language: "ja", customPools: { ja: [] } });
    expect(effectiveFillerPool(s, cfg)).toEqual(["うーん…", "ええと…"]);
  });

  it("returns [] when neither custom nor config has the language", () => {
    const bare: FillerConfig = { threshold_ms: 500, pools: {} };
    expect(effectiveFillerPool(settings({ language: "ko" }), bare)).toEqual([]);
  });
});
