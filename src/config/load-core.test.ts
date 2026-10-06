/**
 * load-core.test.ts — unit tests for loadConfig core contract.
 * happy path, guardrails, cross-section validation failures, reader rejection propagation,
 * default fetch reader, filler, hotkeys.
 *
 * Principle: never hit network/fetch/fs. Inject fake ConfigReader and validate
 * against in-memory map only. Fail-loud contract: schema violations throw ConfigError with
 * .file set to problematic file name and .issues non-empty.
 */

import { describe, expect, it } from "vitest";
import { CONFIG_FILES, loadConfig } from "./load";
import { avatarFixture, goodFixture, guardrailsFixture, readerOf } from "./load-test-helpers";
import { ConfigError } from "./validators/shared";

// ── happy path ─────────────────────────────────────────────────────────────────

describe("loadConfig — happy path", () => {
  it("assembles the whole known-good fixture into the 7-section AppConfig", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });

    expect(cfg.endpoints).toEqual({
      chat_base_url: "http://localhost:8642",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      chat_instructions: "Use the generate_express tool with emotion_id, motion_id, emotion_text.",
    });
    // Validation is shape-preserving: what the file declares is what the section holds.
    expect(cfg.avatar).toEqual(avatarFixture());
    expect(cfg.emotionRegistry.happy).toEqual({
      vrm_expression: "happy",
      fallback: "neutral",
    });
    // emotion_tts_prefix is removed — AppConfig must not contain this key.
    expect("emotionTtsPrefix" in cfg).toBe(false);
    expect(Object.keys(cfg.motions)).toEqual(["idle", "drag", "sit"]);
    expect(cfg.motions.sit.interrupt_policy).toBe("queue");
    expect(cfg.guardrails.rate_limit.overall_max).toBe(20);
  });
});

// ── guardrails.json ────────────────────────────────

describe("loadConfig — guardrails", () => {
  it("preserves the SOT shape as-is", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.guardrails).toEqual({
      debounce_ms: {
        os_event_watcher: 5000,
        user_input_source: 0,
        screen_watcher: 5000,
      },
      rate_limit: {
        window_ms: 3600000,
        tier2_max: 6,
        overall_max: 20,
        cooldown_ms: 300000,
      },
      attachments: guardrailsFixture().attachments,
    });
  });

  it("ConfigError when not an object", async () => {
    const map = goodFixture();
    map["guardrails.json"] = 42;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError on a negative debounce window", async () => {
    const map = goodFixture();
    (
      map["guardrails.json"] as { debounce_ms: Record<string, number> }
    ).debounce_ms.os_event_watcher = -1;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError on a negative rate_limit number", async () => {
    const map = goodFixture();
    (map["guardrails.json"] as { rate_limit: Record<string, number> }).rate_limit.tier2_max = -3;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── validation failures ──────────────────────────────────────────────────────

describe("loadConfig — validation failures throw ConfigError", () => {
  /** Helper to modify one file from good fixture and attempt load. */
  async function loadWith(file: string, value: unknown): Promise<unknown> {
    const map = goodFixture();
    map[file] = value;
    return loadConfig({ read: readerOf(map) });
  }

  /** Checks in one go: rejects with ConfigError, .file matches, .issues non-empty. */
  async function expectConfigError(p: Promise<unknown>, file: string): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).file).toBe(file);
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }

  it("endpoints: fails when chat_base_url is not an http URL", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.endpoints, {
        chat_base_url: "localhost:8642", // missing scheme
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
      }),
      "endpoints.json",
    );
  });

  it("endpoints: fails when chat_instructions is not a string", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.endpoints, {
        chat_base_url: "http://localhost:8642",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        chat_instructions: 123, // not a string
      }),
      "endpoints.json",
    );
  });

  it("avatar: fails when vrm_url is missing", async () => {
    await expectConfigError(loadWith(CONFIG_FILES.avatar, {}), "avatar.json");
  });

  it("avatar: fails when an available entry is not an object", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: ["carlotta"], // string — not an object
      }),
      "avatar.json",
    );
  });

  it("avatar: fails when available is not an array", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: { carlotta: "/vrms/carlotta.vrm" }, // not an array
      }),
      "avatar.json",
    );
  });

  it("avatar: fails when an available entry lacks id/label/url", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [{ id: "carlotta", label: "Carlotta" }], // url missing
      }),
      "avatar.json",
    );
  });

  it("avatar: fails when an available entry's id/label/url is not a string", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [{ id: 1, label: "Carlotta", url: "/vrms/carlotta.vrm" }], // id is number
      }),
      "avatar.json",
    );
  });

  it("avatar: fails when an available entry's source is outside the enum", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "remote" },
        ], // outside bundled|file
      }),
      "avatar.json",
    );
  });

  it("avatar: fails on a duplicate id in available (persistence key collision — the second stays unreachable forever)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm" },
          { id: "carlotta", label: "Carlotta 2", url: "/vrms/carlotta2.vrm" }, // same id
        ],
      }),
      "avatar.json",
    );
  });

  it("avatar: fails when id contains a CSS-selector special character (quote)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: 'carl"otta', label: "Carlotta", url: "/vrms/carlotta.vrm" }, // quote
        ],
      }),
      "avatar.json",
    );
  });

  it("avatar: fails when id contains whitespace (breaks the localStorage key/selector)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: "carl otta", label: "Carlotta", url: "/vrms/carlotta.vrm" }, // space
        ],
      }),
      "avatar.json",
    );
  });

  it("motions: fails when kind is outside the enum", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "assets/motions/idle.vrma",
          kind: "bogus", // invalid kind
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails when vrma_path does not end in .vrma", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "assets/motions/idle.glb", // invalid extension
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails on an empty object (0 motions)", async () => {
    await expectConfigError(loadWith(CONFIG_FILES.motions, {}), "motions.json");
  });

  it("motions: fails when priority is outside 0-100 (or non-finite)", async () => {
    // typeof number passes but must be filtered by range/finiteness (protects dispatcher priority queue).
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "assets/motions/idle.vrma",
          kind: "ambient",
          loop: true,
          priority: 200, // outside 0~100
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails when broker_publish is not a boolean", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          broker_publish: "no", // not boolean
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails when variants contains a non-.vrma entry", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variants: ["/motions/a.vrma", "/motions/b.glb"], // not .vrma
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails when variants has only 1 entry (a single pool is pointless)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variants: ["/motions/a.vrma"], // length 1
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails when variant_policy is outside the enum", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variants: ["/motions/a.vrma", "/motions/b.vrma"],
          variant_policy: "bogus", // outside random|sequential
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: fails when variant_policy exists without variants (dead field)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variant_policy: "random", // meaningless without variants
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("emotion_registry: fails on a key outside the contract enum (a typo fails loud)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.emotionRegistry, {
        hapy: { vrm_expression: "happy", fallback: "neutral" }, // typo
      }),
      "emotion_registry.json",
    );
  });
});

// ── reader rejection ────────────────────────────────────────────────────────────

describe("loadConfig — reader rejection", () => {
  it("a missing file (reader reject) propagates as-is", async () => {
    const map = goodFixture();
    delete map["avatar.json"]; // reader rejects
    await expect(loadConfig({ read: readerOf(map) })).rejects.toThrow(/missing avatar\.json/);
  });
});

// ── default fetch reader: asset-url resolver wiring ───────────────────────────

describe("loadConfig — default fetch reader routes through asset resolver", () => {
  it("in dev (passthrough resolver) fetches the baseUrl/file URL as-is", async () => {
    const fetched: string[] = [];
    const fetchMock = async (url: string) => {
      fetched.push(url);
      const file = url.split("/").pop()!.split("?")[0];
      return { ok: true, json: async () => goodFixture()[file] } as unknown as Response;
    };
    await loadConfig({
      baseUrl: "/configs",
      fetch: fetchMock as unknown as typeof fetch,
      resolveUrl: async (p) => p, // dev passthrough
    });
    expect(fetched).toContain("/configs/endpoints.json");
    expect(fetched).toContain("/configs/avatar.json");
  });

  it("in Tauri (resolver converts to an asset URL) fetches the converted URL", async () => {
    const fetched: string[] = [];
    const fetchMock = async (url: string) => {
      fetched.push(url);
      // Recover original filename from the end and return fixture.
      const file = url.replace(/\?.*$/, "").split("/").pop()!;
      return { ok: true, json: async () => goodFixture()[file] } as unknown as Response;
    };
    await loadConfig({
      baseUrl: "/configs",
      fetch: fetchMock as unknown as typeof fetch,
      resolveUrl: async (p) => `asset://localhost${p}`,
    });
    expect(fetched).toContain("asset://localhost/configs/endpoints.json");
    expect(fetched.every((u) => u.startsWith("asset://localhost/configs/"))).toBe(true);
  });
});

// ── filler.json ─────────────────────────────────────────────────────────────────

function goodFillerPool(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    first: ["うーん…", "そうだね…"],
    repeat: ["ええと…", "ちょっと待ってね…"],
    long_wait: ["ちょっと時間かかってるね…"],
    tool: { _default: ["調べてみるね…"] },
    timeout: ["ごめん、諦めちゃった。"],
    unreachable: ["今つながらないみたい。"],
    ...overrides,
  };
}

function goodFillerFixture(): Record<string, unknown> {
  return {
    gap_ms: 1000,
    gap_jitter_ms: 300,
    max_repeats: 3,
    gap_growth: 2,
    long_wait_ms: 40000,
    pools: {
      ja: goodFillerPool(),
      en: goodFillerPool({
        first: ["Let me think...", "Hmm..."],
        repeat: ["Well...", "Just a sec..."],
      }),
      ko: goodFillerPool({ first: ["음…", "그건…"], repeat: ["글쎄…", "잠깐만…"] }),
    },
  };
}

function fillerFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const map = goodFixture();
  map["filler.json"] = { ...goodFillerFixture(), ...overrides };
  return map;
}

describe("loadConfig — filler (accept)", () => {
  it("preserves the known-good filler fixture as-is", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture()) });
    expect(cfg.filler.gap_ms).toBe(1000);
    expect(cfg.filler.gap_jitter_ms).toBe(300);
    expect(cfg.filler.max_repeats).toBe(3);
    expect(cfg.filler.gap_growth).toBe(2);
    expect(cfg.filler.long_wait_ms).toBe(40000);
    expect(cfg.filler.pools.ja).toEqual(goodFillerPool());
    expect(cfg.filler.pools.en).toEqual(
      goodFillerPool({
        first: ["Let me think...", "Hmm..."],
        repeat: ["Well...", "Just a sec..."],
      }),
    );
    expect(cfg.filler.pools.ko).toEqual(
      goodFillerPool({ first: ["음…", "그건…"], repeat: ["글쎄…", "잠깐만…"] }),
    );
  });

  it("passes with only ja in pools", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 0,
      max_repeats: 0,
      gap_growth: 1,
      long_wait_ms: 40000,
      pools: { ja: goodFillerPool({ first: ["うーん…"], repeat: [] }) },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.filler.pools.ja).toEqual(goodFillerPool({ first: ["うーん…"], repeat: [] }));
    expect(cfg.filler.pools.en).toBeUndefined();
  });

  it("accepts gap_jitter_ms: 0 (no jitter is allowed)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ gap_jitter_ms: 0 })) });
    expect(cfg.filler.gap_jitter_ms).toBe(0);
  });

  it("accepts gap_ms: 0 (no delay is allowed)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ gap_ms: 0 })) });
    expect(cfg.filler.gap_ms).toBe(0);
  });

  it("accepts max_repeats: 0 (no repetition is allowed)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ max_repeats: 0 })) });
    expect(cfg.filler.max_repeats).toBe(0);
  });

  it("accepts gap_growth: 1 (no growth is allowed)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ gap_growth: 1 })) });
    expect(cfg.filler.gap_growth).toBe(1);
  });

  it("accepts long_wait_ms: 0 (no wait is allowed)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ long_wait_ms: 0 })) });
    expect(cfg.filler.long_wait_ms).toBe(0);
  });

  it("passes with every list tier an empty array and tool an empty object (nothing is picked from the pool)", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 500,
      gap_jitter_ms: 100,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: {
        en: goodFillerPool({
          first: [],
          repeat: [],
          long_wait: [],
          tool: {},
          timeout: [],
          unreachable: [],
        }),
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.filler.pools.en).toEqual({
      first: [],
      repeat: [],
      long_wait: [],
      tool: {},
      timeout: [],
      unreachable: [],
    });
  });
});

describe("loadConfig — filler (reject)", () => {
  it("ConfigError when not an object", async () => {
    const map = goodFixture();
    map["filler.json"] = 42;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_ms is missing", async () => {
    const map = goodFixture();
    map["filler.json"] = { ...goodFillerFixture(), gap_ms: undefined };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_ms is negative", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_ms: -1 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_ms is non-finite (Infinity)", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_ms: Infinity })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_ms is a string", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_ms: "1000" })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_jitter_ms is negative", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_jitter_ms: -1 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when max_repeats is missing", async () => {
    const map = goodFixture();
    map["filler.json"] = { ...goodFillerFixture(), max_repeats: undefined };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when max_repeats is negative", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ max_repeats: -1 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when max_repeats is not an integer", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ max_repeats: 1.5 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_growth is missing", async () => {
    const map = goodFixture();
    map["filler.json"] = { ...goodFillerFixture(), gap_growth: undefined };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when gap_growth is below 1", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_growth: 0.5 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when long_wait_ms is missing", async () => {
    const map = goodFixture();
    map["filler.json"] = { ...goodFillerFixture(), long_wait_ms: undefined };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when long_wait_ms is negative", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ long_wait_ms: -1 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when long_wait_ms is non-finite (Infinity)", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ long_wait_ms: Infinity })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools is missing", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools is not an object", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ pools: "ja" })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools is an empty object (at least one language is required)", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ pools: {} })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError on an unknown pools key (fr)", async () => {
    await expect(
      loadConfig({
        read: readerOf(fillerFixture({ pools: { ja: goodFillerPool(), fr: goodFillerPool() } })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools[ja] is an array (the old shape) — not an object", async () => {
    await expect(
      loadConfig({
        read: readerOf(fillerFixture({ pools: { ja: ["うーん…", "そうだね…"] } })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools[ja].first is number[] instead of string[]", async () => {
    await expect(
      loadConfig({
        read: readerOf(fillerFixture({ pools: { ja: goodFillerPool({ first: [1, 2] }) } })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools[ja].repeat is number[] instead of string[]", async () => {
    await expect(
      loadConfig({
        read: readerOf(fillerFixture({ pools: { ja: goodFillerPool({ repeat: [1] }) } })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools[ja] lacks the long_wait tier — the config is ours, no tier may be omitted", async () => {
    const pool = goodFillerPool();
    delete (pool as Record<string, unknown>).long_wait;
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ pools: { ja: pool } })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when pools[ja] lacks the tool tier", async () => {
    const pool = goodFillerPool();
    delete (pool as Record<string, unknown>).tool;
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ pools: { ja: pool } })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("ConfigError when a pools[ja].tool value is not string[]", async () => {
    await expect(
      loadConfig({
        read: readerOf(
          fillerFixture({ pools: { ja: goodFillerPool({ tool: { _default: [1] } }) } }),
        ),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── hotkeys.json ────────────────────────────────────────────────────────────────

function hotkeysFixture(hotkeys: unknown): Record<string, unknown> {
  const map = goodFixture();
  map["hotkeys.json"] = hotkeys;
  return map;
}

describe("loadConfig — hotkeys (accept)", () => {
  it("preserves a valid accelerator string as-is", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.hotkeys.summon_global).toBe("CmdOrCtrl+Shift+Y");
  });

  it("an empty string when the summon_global key is missing (inactive)", async () => {
    const cfg = await loadConfig({ read: readerOf(hotkeysFixture({})) });
    expect(cfg.hotkeys.summon_global).toBe("");
  });

  it("an empty summon_global string stays inactive as-is", async () => {
    const cfg = await loadConfig({ read: readerOf(hotkeysFixture({ summon_global: "" })) });
    expect(cfg.hotkeys.summon_global).toBe("");
  });

  it("passes even a syntactically odd string — the plugin judges validity at registration time (fail-soft)", async () => {
    const cfg = await loadConfig({
      read: readerOf(hotkeysFixture({ summon_global: "NotAKey+++" })),
    });
    expect(cfg.hotkeys.summon_global).toBe("NotAKey+++");
  });
});

describe("loadConfig — hotkeys (reject)", () => {
  it("ConfigError when not an object", async () => {
    await expect(loadConfig({ read: readerOf(hotkeysFixture(42)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("ConfigError when summon_global is not a string", async () => {
    await expect(
      loadConfig({ read: readerOf(hotkeysFixture({ summon_global: 7 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
