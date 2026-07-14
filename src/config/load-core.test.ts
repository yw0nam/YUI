/**
 * load-core.test.ts — loadConfig 코어 계약 단위 테스트.
 * happy path, guardrails, cross-section validation failures, reader 실패 전파,
 * default fetch reader, filler, hotkeys, plainSecretProvider.
 *
 * 원칙: 절대 network/fetch/fs를 타지 않는다. fake ConfigReader를 주입해
 * in-memory map으로만 검증한다. fail-loud 계약: 스키마 위반이면 ConfigError를 던지고
 * .file은 문제 파일명, .issues는 비어 있지 않다.
 */

import { describe, expect, it } from "vitest";
import { CONFIG_FILES, ConfigError, loadConfig, plainSecretProvider } from "./load";
import { goodFixture, readerOf } from "./load-test-helpers";

// ── happy path ─────────────────────────────────────────────────────────────────

describe("loadConfig — happy path", () => {
  it("known-good fixture 전체를 7개 섹션의 AppConfig로 조립한다", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });

    expect(cfg.endpoints).toEqual({
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
      chat_instructions: "Use the generate_express tool with emotion_id, motion_id, emotion_text.",
    });
    expect(cfg.avatar).toEqual({ vrm_url: "/vrms/carlotta.vrm" });
    expect(cfg.emotionRegistry.happy).toEqual({
      vrm_expression: "happy",
      fallback: "neutral",
    });
    // emotion_tts_prefix는 제거됨 — AppConfig에 키가 없어야 한다.
    expect("emotionTtsPrefix" in cfg).toBe(false);
    expect(Object.keys(cfg.motions)).toEqual(["idle", "drag", "sit"]);
    expect(cfg.motions.sit.interrupt_policy).toBe("queue");
    expect(cfg.guardrails.rate_limit.overall_max).toBe(20);
  });
});

// ── guardrails.json ────────────────────────────────

describe("loadConfig — guardrails", () => {
  it("SOT 모양을 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.guardrails).toEqual({
      dnd: { app_blocklist: [] },
      debounce_ms: {
        idle_watcher: 30000,
        os_event_watcher: 5000,
        backend_push_source: 10000,
        user_input_source: 0,
      },
      rate_limit: {
        window_ms: 3600000,
        tier2_max: 6,
        tier3_max: 2,
        overall_max: 20,
        cooldown_ms: 300000,
      },
    });
  });

  it("app_blocklist에 string 항목을 보존한다", async () => {
    const map = goodFixture();
    (map["guardrails.json"] as { dnd: { app_blocklist: string[] } }).dnd.app_blocklist = [
      "Keynote",
      "Zoom",
    ];
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.guardrails.dnd.app_blocklist).toEqual(["Keynote", "Zoom"]);
  });

  it("객체가 아니면 ConfigError", async () => {
    const map = goodFixture();
    map["guardrails.json"] = 42;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("음수 debounce window는 ConfigError", async () => {
    const map = goodFixture();
    (map["guardrails.json"] as { debounce_ms: Record<string, number> }).debounce_ms.idle_watcher =
      -1;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("음수 rate_limit 수치는 ConfigError", async () => {
    const map = goodFixture();
    (map["guardrails.json"] as { rate_limit: Record<string, number> }).rate_limit.tier2_max = -3;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("app_blocklist가 string[]이 아니면 ConfigError", async () => {
    const map = goodFixture();
    (map["guardrails.json"] as { dnd: { app_blocklist: unknown } }).dnd.app_blocklist = ["ok", 5];
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("dnd 누락은 ConfigError", async () => {
    const map = goodFixture();
    delete (map["guardrails.json"] as Record<string, unknown>).dnd;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── validation failures ──────────────────────────────────────────────────────

describe("loadConfig — validation failures throw ConfigError", () => {
  /** good fixture에서 한 파일만 변형해 로드를 시도하는 헬퍼. */
  async function loadWith(file: string, value: unknown): Promise<unknown> {
    const map = goodFixture();
    map[file] = value;
    return loadConfig({ read: readerOf(map) });
  }

  /** rejects → ConfigError, .file 일치, .issues 비어있지 않음을 한 번에 검사. */
  async function expectConfigError(p: Promise<unknown>, file: string): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).file).toBe(file);
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }

  it("endpoints: chat_base_url이 http URL이 아니면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.endpoints, {
        chat_base_url: "localhost:8642", // 스킴 없음
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
      }),
      "endpoints.json",
    );
  });

  it("endpoints: chat_endpoint이 '/'로 시작하지 않으면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.endpoints, {
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "v1/responses", // 슬래시 없음
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
      }),
      "endpoints.json",
    );
  });

  it("endpoints: chat_instructions가 문자열이 아니면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.endpoints, {
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        chat_instructions: 123, // 문자열이 아님
      }),
      "endpoints.json",
    );
  });

  it("avatar: vrm_url 누락 시 실패", async () => {
    await expectConfigError(loadWith(CONFIG_FILES.avatar, {}), "avatar.json");
  });

  it("avatar: available 항목이 객체가 아니면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: ["carlotta"], // 문자열 — 객체가 아님
      }),
      "avatar.json",
    );
  });

  it("avatar: available가 배열이 아니면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: { carlotta: "/vrms/carlotta.vrm" }, // 배열이 아님
      }),
      "avatar.json",
    );
  });

  it("avatar: available 항목에 id/label/url이 없으면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [{ id: "carlotta", label: "Carlotta" }], // url 누락
      }),
      "avatar.json",
    );
  });

  it("avatar: available 항목의 id/label/url이 문자열이 아니면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [{ id: 1, label: "Carlotta", url: "/vrms/carlotta.vrm" }], // id 숫자
      }),
      "avatar.json",
    );
  });

  it("avatar: available 항목의 source가 enum 밖이면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "remote" },
        ], // bundled|file 밖
      }),
      "avatar.json",
    );
  });

  it("avatar: available에 id가 중복되면 실패(영속화 키 충돌 — 두 번째가 영구 unreachable)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm" },
          { id: "carlotta", label: "Carlotta 2", url: "/vrms/carlotta2.vrm" }, // 같은 id
        ],
      }),
      "avatar.json",
    );
  });

  it("avatar: id에 CSS-selector 특수문자(따옴표)가 있으면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: 'carl"otta', label: "Carlotta", url: "/vrms/carlotta.vrm" }, // 따옴표
        ],
      }),
      "avatar.json",
    );
  });

  it("avatar: id에 공백이 있으면 실패(localStorage 키/selector 깨짐)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.avatar, {
        vrm_url: "/vrms/carlotta.vrm",
        available: [
          { id: "carl otta", label: "Carlotta", url: "/vrms/carlotta.vrm" }, // 공백
        ],
      }),
      "avatar.json",
    );
  });

  it("motions: kind가 enum 밖이면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "assets/motions/idle.vrma",
          kind: "bogus", // 잘못된 kind
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: vrma_path가 .vrma로 끝나지 않으면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "assets/motions/idle.glb", // 잘못된 확장자
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: 빈 객체면(0개 모션) 실패", async () => {
    await expectConfigError(loadWith(CONFIG_FILES.motions, {}), "motions.json");
  });

  it("motions: priority가 0~100 범위 밖(또는 비유한)이면 실패", async () => {
    // typeof number는 통과하지만 범위/유한성으로 걸러야 한다(dispatcher 우선순위 큐 보호).
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "assets/motions/idle.vrma",
          kind: "ambient",
          loop: true,
          priority: 200, // 0~100 밖
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: broker_publish가 boolean이 아니면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          broker_publish: "no", // boolean 아님
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: variants에 .vrma 아닌 항목이 있으면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variants: ["/motions/a.vrma", "/motions/b.glb"], // .vrma 아님
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: variants가 1개뿐이면 실패(단일 풀은 무의미)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variants: ["/motions/a.vrma"], // 길이 1
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: variant_policy가 enum 밖이면 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variants: ["/motions/a.vrma", "/motions/b.vrma"],
          variant_policy: "bogus", // random|sequential 밖
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("motions: variant_policy만 있고 variants가 없으면 실패(dead 필드)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.motions, {
        idle: {
          vrma_path: "/motions/a.vrma",
          variant_policy: "random", // variants 없이 의미 없음
          kind: "ambient",
          loop: true,
          priority: 0,
          interrupt_policy: "replace",
        },
      }),
      "motions.json",
    );
  });

  it("emotion_registry: contract enum 밖의 키면 실패(오탈자 fail-loud)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.emotionRegistry, {
        hapy: { vrm_expression: "happy", fallback: "neutral" }, // 오탈자
      }),
      "emotion_registry.json",
    );
  });
});

// ── reader 실패 전파 ────────────────────────────────────────────────────────────

describe("loadConfig — reader rejection", () => {
  it("파일 누락(reader reject)은 그대로 전파된다", async () => {
    const map = goodFixture();
    delete map["avatar.json"]; // reader가 reject
    await expect(loadConfig({ read: readerOf(map) })).rejects.toThrow(/missing avatar\.json/);
  });
});

// ── default fetch reader: asset-url resolver wiring ───────────────────────────

describe("loadConfig — default fetch reader routes through asset resolver", () => {
  it("dev(passthrough resolver)에서는 baseUrl/파일 URL을 그대로 fetch한다", async () => {
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

  it("Tauri(resolver가 asset URL로 변환)면 변환된 URL로 fetch한다", async () => {
    const fetched: string[] = [];
    const fetchMock = async (url: string) => {
      fetched.push(url);
      // 원래 파일명을 끝에서 복구해 fixture를 돌려준다.
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

function goodFillerFixture(): Record<string, unknown> {
  return {
    gap_ms: 1000,
    gap_jitter_ms: 300,
    pools: {
      ja: { first: ["うーん…", "そうだね…"], repeat: ["ええと…", "ちょっと待ってね…"] },
      en: { first: ["Let me think...", "Hmm..."], repeat: ["Well...", "Just a sec..."] },
      ko: { first: ["음…", "그건…"], repeat: ["글쎄…", "잠깐만…"] },
    },
  };
}

function fillerFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const map = goodFixture();
  map["filler.json"] = { ...goodFillerFixture(), ...overrides };
  return map;
}

describe("loadConfig — filler (accept)", () => {
  it("known-good filler fixture를 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture()) });
    expect(cfg.filler.gap_ms).toBe(1000);
    expect(cfg.filler.gap_jitter_ms).toBe(300);
    expect(cfg.filler.pools.ja).toEqual({
      first: ["うーん…", "そうだね…"],
      repeat: ["ええと…", "ちょっと待ってね…"],
    });
    expect(cfg.filler.pools.en).toEqual({
      first: ["Let me think...", "Hmm..."],
      repeat: ["Well...", "Just a sec..."],
    });
    expect(cfg.filler.pools.ko).toEqual({
      first: ["음…", "그건…"],
      repeat: ["글쎄…", "잠깐만…"],
    });
  });

  it("pools에 ja만 있어도 통과한다", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 0,
      pools: { ja: { first: ["うーん…"], repeat: [] } },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.filler.pools.ja).toEqual({ first: ["うーん…"], repeat: [] });
    expect(cfg.filler.pools.en).toBeUndefined();
  });

  it("gap_jitter_ms: 0은 통과한다(지터 없음 허용)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ gap_jitter_ms: 0 })) });
    expect(cfg.filler.gap_jitter_ms).toBe(0);
  });

  it("gap_ms: 0은 통과한다(지연 없음 허용)", async () => {
    const cfg = await loadConfig({ read: readerOf(fillerFixture({ gap_ms: 0 })) });
    expect(cfg.filler.gap_ms).toBe(0);
  });

  it("first[]와 repeat[] 모두 빈 배열이어도 통과한다(풀에서 선택 안 함)", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 500,
      gap_jitter_ms: 100,
      pools: { en: { first: [], repeat: [] } },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.filler.pools.en).toEqual({ first: [], repeat: [] });
  });
});

describe("loadConfig — filler (reject)", () => {
  it("객체가 아니면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = 42;
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("gap_ms가 없으면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = { gap_jitter_ms: 300, pools: { ja: { first: ["うーん…"], repeat: [] } } };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("gap_ms가 음수이면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_ms: -1 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("gap_ms가 비유한(Infinity)이면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_ms: Infinity })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("gap_ms가 문자열이면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_ms: "1000" })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("gap_jitter_ms가 없으면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = { gap_ms: 1000, pools: { ja: { first: ["うーん…"], repeat: [] } } };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("gap_jitter_ms가 음수이면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(fillerFixture({ gap_jitter_ms: -1 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools가 없으면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = { gap_ms: 1000, gap_jitter_ms: 300 };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools가 객체가 아니면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = { gap_ms: 1000, gap_jitter_ms: 300, pools: "ja" };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools가 빈 객체이면 ConfigError (최소 한 개 언어 필요)", async () => {
    const map = goodFixture();
    map["filler.json"] = { gap_ms: 1000, gap_jitter_ms: 300, pools: {} };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools에 알 수 없는 키(fr)가 있으면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      pools: { ja: { first: ["うーん…"], repeat: [] }, fr: { first: ["hmm…"], repeat: [] } },
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools[ja]가 배열(旧 shape)이면 ConfigError — {first,repeat} 객체가 아님", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      pools: { ja: ["うーん…", "そうだね…"] },
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools[ja].first가 string[]이 아닌 number[]이면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      pools: { ja: { first: [1, 2], repeat: [] } },
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });

  it("pools[ja].repeat가 string[]이 아닌 number[]이면 ConfigError", async () => {
    const map = goodFixture();
    map["filler.json"] = {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      pools: { ja: { first: ["うーん…"], repeat: [1] } },
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── hotkeys.json ────────────────────────────────────────────────────────────────

function hotkeysFixture(hotkeys: unknown): Record<string, unknown> {
  const map = goodFixture();
  map["hotkeys.json"] = hotkeys;
  return map;
}

describe("loadConfig — hotkeys (accept)", () => {
  it("유효한 accelerator 문자열을 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.hotkeys.summon_global).toBe("CmdOrCtrl+Shift+Y");
  });

  it("summon_global 키가 없으면 빈 문자열(비활성)", async () => {
    const cfg = await loadConfig({ read: readerOf(hotkeysFixture({})) });
    expect(cfg.hotkeys.summon_global).toBe("");
  });

  it("summon_global이 빈 문자열이면 그대로 비활성", async () => {
    const cfg = await loadConfig({ read: readerOf(hotkeysFixture({ summon_global: "" })) });
    expect(cfg.hotkeys.summon_global).toBe("");
  });

  it("문법이 이상한 문자열도 통과한다 — 유효성은 등록 시점 플러그인이 판정(fail-soft)", async () => {
    const cfg = await loadConfig({
      read: readerOf(hotkeysFixture({ summon_global: "NotAKey+++" })),
    });
    expect(cfg.hotkeys.summon_global).toBe("NotAKey+++");
  });
});

describe("loadConfig — hotkeys (reject)", () => {
  it("객체가 아니면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(hotkeysFixture(42)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("summon_global이 문자열이 아니면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(hotkeysFixture({ summon_global: 7 })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── plainSecretProvider ─────────────────────────────────────────────────────────

describe("plainSecretProvider", () => {
  it("값이 있으면 반환, 모르는 키는 undefined, 절대 throw 안 함", async () => {
    const sp = plainSecretProvider({ chat_api_key: "sk-123" });
    await expect(sp.get("chat_api_key")).resolves.toBe("sk-123");
    await expect(sp.get("nope")).resolves.toBeUndefined();
  });

  it("빈 레코드(기본값)에서도 undefined만 반환한다", async () => {
    const sp = plainSecretProvider();
    await expect(sp.get("anything")).resolves.toBeUndefined();
  });
});
