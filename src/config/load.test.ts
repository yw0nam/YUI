/**
 * load.test.ts — loadConfig + validators + SecretProvider 단위 테스트 (#22, F8).
 *
 * 원칙: 절대 network/fetch/fs를 타지 않는다. fake ConfigReader(`read` 옵션)를 주입해
 * in-memory map({filename → parsed JSON})으로만 검증한다. fixture는 실제 configs/*.json
 * 모양을 그대로 미러링한다(configs.test.ts와 동일 shape).
 *
 * fail-loud 계약: 어떤 파일이든 스키마 위반이면 ConfigError를 던지고, .file은 문제 파일명,
 * .issues는 비어 있지 않다.
 */

import { describe, it, expect } from "vitest";
import {
  loadConfig,
  ConfigError,
  plainSecretProvider,
  CONFIG_FILES,
  type ConfigReader,
} from "./load";
import type { EndpointsConfig } from "../contract";

// ── fixtures (실제 configs/*.json 미러) ────────────────────────────────────────

/** known-good 파일 묶음. 각 테스트는 이걸 복제·일부 변형해서 쓴다. */
function goodFixture(): Record<string, unknown> {
  return {
    "endpoints.json": {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
      chat_instructions: "Use the generate_express tool with emotion_id, motion_id, emotion_text.",
    },
    "avatar.json": { vrm_url: "/vrms/carlotta.vrm" },
    "emotion_registry.json": {
      neutral: { vrm_expression: "neutral", fallback: "neutral" },
      happy: { vrm_expression: "happy", fallback: "neutral" },
    },
    "motions.json": {
      idle: {
        vrma_path: "assets/motions/idle.vrma",
        kind: "ambient",
        loop: true,
        priority: 0,
        interrupt_policy: "replace",
      },
      drag: {
        vrma_path: "assets/motions/drag.vrma",
        kind: "reactive",
        loop: true,
        priority: 80,
        interrupt_policy: "replace",
      },
      sit: {
        vrma_path: "assets/motions/sit.vrma",
        kind: "state",
        loop: true,
        priority: 50,
        interrupt_policy: "queue",
      },
    },
    "guardrails.json": {
      dnd: { app_blocklist: [], camera_idle_off_ms: 30000 },
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
    },
  };
}

/** in-memory map을 읽는 reader. 파일이 없으면 reject(누락 전파 테스트). */
function readerOf(map: Record<string, unknown>): ConfigReader {
  return async (file) => {
    if (!(file in map)) {
      throw new Error(`fake reader: missing ${file}`);
    }
    return map[file];
  };
}

// ── happy path ─────────────────────────────────────────────────────────────────

describe("loadConfig — happy path", () => {
  it("known-good fixture 전체를 5개 섹션의 AppConfig로 조립한다", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });

    expect(cfg.endpoints).toEqual({
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
      chat_instructions:
        "Use the generate_express tool with emotion_id, motion_id, emotion_text.",
      compact_threshold_ratio: 0.7,
      compact_resume_ratio: 0.5,
      compact_timeout_ms: 12000,
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

// ── guardrails.json (#25, event-dispatcher.md §6) ────────────────────────────────

describe("loadConfig — guardrails", () => {
  it("SOT 모양을 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.guardrails).toEqual({
      dnd: { app_blocklist: [], camera_idle_off_ms: 30000 },
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
    (map["guardrails.json"] as { dnd: { app_blocklist: string[] } }).dnd.app_blocklist = ["Keynote", "Zoom"];
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
    (map["guardrails.json"] as { debounce_ms: Record<string, number> }).debounce_ms.idle_watcher = -1;
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

// ── motions.variants / variant_policy (D-MOTION-VARIANTS) ───────────────────────

describe("loadConfig — motions.variants", () => {
  it("variants/variant_policy를 검증 후 그대로 보존한다", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      idle: {
        vrma_path: "/motions/a.vrma",
        variants: ["/motions/a.vrma", "/motions/b.vrma"],
        variant_policy: "random",
        kind: "ambient",
        loop: true,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.motions.idle.variants).toEqual(["/motions/a.vrma", "/motions/b.vrma"]);
    expect(cfg.motions.idle.variant_policy).toBe("random");
  });

  it("variants 없는 항목은 통과하고 variants는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.motions.idle.variants).toBeUndefined();
    expect(cfg.motions.idle.variant_policy).toBeUndefined();
  });
});

// ── avatar.available manifest (#94 VRM swap) ────────────────────────────────────

describe("loadConfig — avatar.available", () => {
  it("available가 없으면 vrm_url만 담고 available는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar).toEqual({ vrm_url: "/vrms/carlotta.vrm" });
    expect(cfg.avatar.available).toBeUndefined();
  });

  it("유효한 available[]를 그대로 보존한다(source 포함/생략 모두)", async () => {
    const map = goodFixture();
    map["avatar.json"] = {
      vrm_url: "/vrms/carlotta.vrm",
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        { id: "guest", label: "Guest", url: "https://example.com/guest.vrm" },
      ],
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.avatar.vrm_url).toBe("/vrms/carlotta.vrm");
    expect(cfg.avatar.available).toEqual([
      { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
      { id: "guest", label: "Guest", url: "https://example.com/guest.vrm" },
    ]);
  });

  it("서로 다른 단순 id([A-Za-z0-9._-])는 모두 통과한다", async () => {
    const map = goodFixture();
    map["avatar.json"] = {
      vrm_url: "/vrms/carlotta.vrm",
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm" },
        { id: "guest_2", label: "Guest 2", url: "https://example.com/g2.vrm" },
        { id: "v1.0-final", label: "V1", url: "/vrms/v1.vrm" },
      ],
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.avatar.available?.map((a) => a.id)).toEqual(["carlotta", "guest_2", "v1.0-final"]);
  });
});

// ── avatar.framing fit-to-bounds (#106) ─────────────────────────────────────────

describe("loadConfig — avatar.framing", () => {
  /** rejects → ConfigError on avatar.json with non-empty issues. */
  async function expectAvatarError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("avatar.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }
  async function loadWithAvatar(avatar: unknown): Promise<unknown> {
    const map = goodFixture();
    map[CONFIG_FILES.avatar] = avatar;
    return loadConfig({ read: readerOf(map) });
  }

  it("유효한 framing {margin, fov}를 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf({
        ...goodFixture(),
        "avatar.json": { vrm_url: "/vrms/carlotta.vrm", framing: { margin: 0.1, fov: 30 } },
      }),
    });
    expect(cfg.avatar.framing).toEqual({ margin: 0.1, fov: 30 });
  });

  it("framing이 없으면 undefined (하위호환)", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar.framing).toBeUndefined();
  });

  it("fov: 0 (열린구간 밖)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: 0 } }),
    );
  });

  it("fov: 180 (열린구간 밖)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: 180 } }),
    );
  });

  it("fov: -5 (음수)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: -5 } }),
    );
  });

  it('fov: "30" (문자열)이면 실패', async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: "30" } }),
    );
  });

  it("margin: -0.1 (음수)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { margin: -0.1 } }),
    );
  });

  it("margin: NaN (비유한)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { margin: Number.NaN } }),
    );
  });
});

// ── irodori_TTS provider (PR-A) ────────────────────────────────────────────────

describe("loadConfig — endpoints irodori provider", () => {
  /** openai 필드는 유지하되 irodori 필드를 채운 valid endpoints. */
  function irodoriEndpoints(): Record<string, unknown> {
    return {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "irodori",
      irodori_base_url: "http://localhost:8091",
      irodori_speaker: "ナツメ",
      irodori_voices: [
        { id: "ナツメ", label: "ナツメ", ref_url: "/references/ナツメ/merged_audio.mp3" },
        { id: "レナ", ref_url: "/references/レナ/merged_audio.mp3" },
      ],
      irodori_num_steps: 32,
      irodori_cfg_scale_text: 0.5,
      irodori_cfg_scale_speaker: 2,
      irodori_seconds: 10,
      tts_max_inflight: 1,
    };
  }

  it("완전한 irodori endpoints는 모든 필드를 보존한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = irodoriEndpoints();
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints).toEqual({
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "irodori",
      irodori_base_url: "http://localhost:8091",
      irodori_speaker: "ナツメ",
      irodori_voices: [
        { id: "ナツメ", label: "ナツメ", ref_url: "/references/ナツメ/merged_audio.mp3" },
        { id: "レナ", ref_url: "/references/レナ/merged_audio.mp3" },
      ],
      irodori_num_steps: 32,
      irodori_cfg_scale_text: 0.5,
      irodori_cfg_scale_speaker: 2,
      irodori_seconds: 10,
      tts_max_inflight: 1,
      compact_threshold_ratio: 0.7,
      compact_resume_ratio: 0.5,
      compact_timeout_ms: 12000,
    });
  });

  it("tts_provider 생략 시 irodori로 resolve되어 출력에 박힌다", async () => {
    const map = goodFixture();
    const ep = irodoriEndpoints();
    delete ep.tts_provider;
    map["endpoints.json"] = ep;
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.tts_provider).toBe("irodori");
  });

  it("tts_provider: openai 최소 구성은 irodori 필드 없이도 통과한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.tts_provider).toBe("openai");
    expect(cfg.endpoints.irodori_base_url).toBeUndefined();
    expect(cfg.endpoints.irodori_speaker).toBeUndefined();
  });
});

// ── broker_base_url (optional Expression Broker MCP endpoint) ──────────────────

describe("loadConfig — endpoints broker_base_url", () => {
  function baseEndpoints(): Record<string, unknown> {
    return {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
    };
  }

  it("유효한 broker_base_url을 출력에 보존한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), broker_base_url: "http://localhost:3201/mcp" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.broker_base_url).toBe("http://localhost:3201/mcp");
  });

  it("broker_base_url이 없으면 undefined(선택)", async () => {
    const map = goodFixture();
    map["endpoints.json"] = baseEndpoints();
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.broker_base_url).toBeUndefined();
  });

  it("broker_base_url이 http(s) URL이 아니면 실패", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), broker_base_url: "localhost:3201/mcp" };
    const p = loadConfig({ read: readerOf(map) });
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("endpoints.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  });
});

// ── compaction knobs (context window + threshold/resume ratio + timeout) ────────

describe("loadConfig — endpoints compaction knobs", () => {
  function baseEndpoints(): Record<string, unknown> {
    return {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
    };
  }
  async function loadWith(value: unknown): Promise<unknown> {
    const map = goodFixture();
    map[CONFIG_FILES.endpoints] = value;
    return loadConfig({ read: readerOf(map) });
  }
  async function expectEndpointsError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("endpoints.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }

  it("네 필드를 모두 명시하면 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf({
        ...goodFixture(),
        "endpoints.json": {
          ...baseEndpoints(),
          chat_model_context_window: 128000,
          compact_threshold_ratio: 0.6,
          compact_resume_ratio: 0.4,
          compact_timeout_ms: 8000,
        },
      }),
    });
    expect(cfg.endpoints.chat_model_context_window).toBe(128000);
    expect(cfg.endpoints.compact_threshold_ratio).toBe(0.6);
    expect(cfg.endpoints.compact_resume_ratio).toBe(0.4);
    expect(cfg.endpoints.compact_timeout_ms).toBe(8000);
  });

  it("ratio/timeout이 없으면 문서화된 기본값으로 resolve된다", async () => {
    const cfg = await loadWith(baseEndpoints());
    const ep = (cfg as { endpoints: EndpointsConfig }).endpoints;
    expect(ep.compact_threshold_ratio).toBe(0.7);
    expect(ep.compact_resume_ratio).toBe(0.5);
    expect(ep.compact_timeout_ms).toBe(12000);
  });

  it("chat_model_context_window는 없으면 undefined(선택)", async () => {
    const cfg = await loadWith(baseEndpoints());
    const ep = (cfg as { endpoints: EndpointsConfig }).endpoints;
    expect(ep.chat_model_context_window).toBeUndefined();
  });

  it("chat_model_context_window가 0 이하면 실패", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), chat_model_context_window: 0 }));
  });

  it("chat_model_context_window가 비유한(Infinity)이면 실패", async () => {
    await expectEndpointsError(
      loadWith({ ...baseEndpoints(), chat_model_context_window: Infinity }),
    );
  });

  it("compact_threshold_ratio가 (0,1] 밖(>1)이면 실패", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), compact_threshold_ratio: 1.5 }));
  });

  it("compact_threshold_ratio가 0이면 실패((0,1] 열린 하한)", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), compact_threshold_ratio: 0 }));
  });

  it("compact_resume_ratio가 (0,1] 밖(음수)이면 실패", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), compact_resume_ratio: -0.1 }));
  });

  it("compact_timeout_ms가 0 이하면 실패", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), compact_timeout_ms: 0 }));
  });

  it("compact_timeout_ms가 숫자가 아니면 실패", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), compact_timeout_ms: "8000" }));
  });
});

describe("loadConfig — endpoints irodori validation failures", () => {
  async function loadWith(value: unknown): Promise<unknown> {
    const map = goodFixture();
    map[CONFIG_FILES.endpoints] = value;
    return loadConfig({ read: readerOf(map) });
  }
  async function expectEndpointsError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("endpoints.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }

  it("tts_provider가 enum 밖이면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "elevenlabs",
      }),
    );
  });

  it("provider irodori(default)인데 irodori_base_url이 없으면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        // tts_provider 생략 → irodori default
        irodori_speaker: "ナツメ",
      }),
    );
  });

  it("provider irodori인데 irodori_speaker가 없으면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
      }),
    );
  });

  it("irodori_base_url이 http(s) URL이 아니면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "localhost:8091", // 스킴 없음
        irodori_speaker: "ナツメ",
      }),
    );
  });

  it("irodori_voices가 배열이 아니면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
        irodori_voices: { ナツメ: "/references/ナツメ/merged_audio.mp3" }, // 객체
      }),
    );
  });

  it("irodori_voices 항목의 ref_url이 '/'로 시작하지 않으면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
        irodori_voices: [
          { id: "ナツメ", ref_url: "references/ナツメ/merged_audio.mp3" }, // 슬래시 없음
        ],
      }),
    );
  });

  it("irodori_voices 항목의 id가 비어있으면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
        irodori_voices: [{ id: "", ref_url: "/references/x/merged_audio.mp3" }],
      }),
    );
  });

  it("irodori_num_steps가 정수 ≥ 1이 아니면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
        irodori_num_steps: 0,
      }),
    );
  });

  it("irodori_cfg_scale_text가 0 이하면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
        irodori_cfg_scale_text: 0,
      }),
    );
  });

  it("irodori_seconds가 비유한(Infinity)이면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:8091",
        irodori_speaker: "ナツメ",
        irodori_seconds: Infinity,
      }),
    );
  });

  it("tts_max_inflight가 1 미만이면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_provider: "openai",
        tts_max_inflight: 0,
      }),
    );
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
