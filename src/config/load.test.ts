/**
 * load.test.ts — loadConfig + validators + SecretProvider 단위 테스트.
 *
 * 원칙: 절대 network/fetch/fs를 타지 않는다. fake ConfigReader(`read` 옵션)를 주입해
 * in-memory map({filename → parsed JSON})으로만 검증한다. fixture는 실제 configs/*.json
 * 모양을 그대로 미러링한다(configs.test.ts와 동일 shape).
 *
 * fail-loud 계약: 어떤 파일이든 스키마 위반이면 ConfigError를 던지고, .file은 문제 파일명,
 * .issues는 비어 있지 않다.
 */

import { describe, expect, it } from "vitest";
import type { EndpointsConfig } from "../contract";
import {
  CONFIG_FILES,
  ConfigError,
  type ConfigReader,
  loadConfig,
  plainSecretProvider,
} from "./load";

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
    "filler.json": {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      pools: {
        ja: { first: ["うーん…", "そうだね…"], repeat: ["ええと…", "ちょっと待ってね…"] },
        en: { first: ["Let me think...", "Hmm..."], repeat: ["Well...", "Just a sec..."] },
        ko: { first: ["음…", "그건…"], repeat: ["글쎄…", "잠깐만…"] },
      },
    },
    "hotkeys.json": { summon_global: "CmdOrCtrl+Shift+Y" },
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

  it("broker_publish:false를 검증 후 그대로 보존한다", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      idle: {
        vrma_path: "/motions/a.vrma",
        broker_publish: false,
        kind: "oneshot",
        loop: false,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.motions.idle.broker_publish).toBe(false);
  });

  it("broker_publish 없는 항목은 통과하고 broker_publish는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.motions.idle.broker_publish).toBeUndefined();
  });

  it("reactive 루프 + broker_publish:false 항목(falling)을 그대로 보존한다", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      falling: {
        vrma_path: "/motions/falling_loop.vrma",
        kind: "reactive",
        loop: true,
        priority: 78,
        interrupt_policy: "replace",
        broker_publish: false,
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.motions.falling.kind).toBe("reactive");
    expect(cfg.motions.falling.loop).toBe(true);
    expect(cfg.motions.falling.broker_publish).toBe(false);
    expect(cfg.motions.falling.vrma_path).toBe("/motions/falling_loop.vrma");
  });
});

// ── motions.cycle_dwell_ms (cycle 정착 프레임 유지) ──────────────────────────────

/** cycle 모션 한 항목(variants>1 + loop:true)을 motions.json으로 깔아주는 fixture. */
function cycleMotionFixture(dwell?: number): Record<string, unknown> {
  const map = goodFixture();
  map["motions.json"] = {
    perch: {
      vrma_path: "/motions/a.vrma",
      variants: ["/motions/a.vrma", "/motions/b.vrma"],
      variant_policy: "random",
      ...(dwell !== undefined ? { cycle_dwell_ms: dwell } : {}),
      kind: "state",
      loop: true,
      priority: 50,
      interrupt_policy: "replace",
    },
  };
  return map;
}

describe("loadConfig — motions.cycle_dwell_ms", () => {
  it("유효한 cycle_dwell_ms를 검증 후 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(cycleMotionFixture(4000)) });
    expect(cfg.motions.perch.cycle_dwell_ms).toBe(4000);
  });

  it("cycle_dwell_ms 없는 항목은 통과하고 cycle_dwell_ms는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(cycleMotionFixture()) });
    expect(cfg.motions.perch.cycle_dwell_ms).toBeUndefined();
  });

  it("정수가 아니면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(cycleMotionFixture(1000.5)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("음수면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(cycleMotionFixture(-1)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("60000 초과면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(cycleMotionFixture(60001)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("cycle 모션(variants>1 + loop)이 아닌데 cycle_dwell_ms가 있으면 ConfigError", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      idle: {
        vrma_path: "/motions/a.vrma",
        cycle_dwell_ms: 4000,
        kind: "ambient",
        loop: false,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── motions.pingpong / loop_cycles (ping-pong loop) ─────────────────────────────

/** multi-variant loop 항목에 pingpong/loop_cycles를 깔아주는 fixture. */
function pingpongMotionFixture(over: Record<string, unknown>): Record<string, unknown> {
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
      ...over,
    },
  };
  return map;
}

describe("loadConfig — motions.pingpong / loop_cycles", () => {
  it("유효한 pingpong:true + loop_cycles:[1,3]을 검증 후 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [1, 3] })),
    });
    expect(cfg.motions.idle.pingpong).toBe(true);
    expect(cfg.motions.idle.loop_cycles).toEqual([1, 3]);
  });

  it("pingpong/loop_cycles 없는 항목은 통과하고 둘 다 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.motions.idle.pingpong).toBeUndefined();
    expect(cfg.motions.idle.loop_cycles).toBeUndefined();
  });

  it("pingpong이 boolean이 아니면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ pingpong: "yes" })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("pingpong:true + loop:false면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ pingpong: true, loop: false })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("pingpong:true + crossfade_loop:true면 ConfigError(상호 배타)", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, crossfade_loop: true })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles가 pingpong:true 없이 있으면 ConfigError(dead 필드)", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ loop_cycles: [1, 3] })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles가 2-요소가 아니면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [1] })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles의 lo>hi면 ConfigError", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [3, 1] })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles에 0이 있으면 ConfigError(양의 정수)", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [0, 2] })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles에 정수가 아닌 값이 있으면 ConfigError", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [1, 2.5] })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── motions.fade_ms (entry-level default crossfade) ─────────────────────────────

/** 한 모션 항목에 fade_ms를 깔아주는 fixture. */
function fadeMotionFixture(fade?: number): Record<string, unknown> {
  const map = goodFixture();
  map["motions.json"] = {
    perch: {
      vrma_path: "/motions/a.vrma",
      ...(fade !== undefined ? { fade_ms: fade } : {}),
      kind: "state",
      loop: true,
      priority: 50,
      interrupt_policy: "replace",
    },
  };
  return map;
}

describe("loadConfig — motions.fade_ms", () => {
  it("유효한 fade_ms를 검증 후 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(fadeMotionFixture(700)) });
    expect(cfg.motions.perch.fade_ms).toBe(700);
  });

  it("fade_ms 없는 항목은 통과하고 fade_ms는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(fadeMotionFixture()) });
    expect(cfg.motions.perch.fade_ms).toBeUndefined();
  });

  it("정수가 아니면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(fadeMotionFixture(700.5)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("음수면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(fadeMotionFixture(-1)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("5000 초과면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(fadeMotionFixture(5001)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });
});

// ── avatar.available manifest (VRM swap) ────────────────────────────────────────

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

// ── avatar.framing fit-to-bounds ────────────────────────────────────────────────

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
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: 0 } }));
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

// ── avatar.hit_test click-through ───────────────────────────────────────────────

describe("loadConfig — avatar.hit_test", () => {
  async function expectAvatarError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("avatar.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }
  async function loadWithAvatar(avatar: unknown): Promise<Awaited<ReturnType<typeof loadConfig>>> {
    const map = goodFixture();
    map[CONFIG_FILES.avatar] = avatar;
    return loadConfig({ read: readerOf(map) });
  }

  it("유효한 hit_test 전체 블록을 그대로 보존한다", async () => {
    const cfg = await loadWithAvatar({
      vrm_url: "/vrms/carlotta.vrm",
      hit_test: {
        hysteresis_margin_px: 8,
        poll_interval_ms: 200,
        debounce_samples: 2,
        alpha_threshold: 0.1,
      },
    });
    expect(cfg.avatar.hit_test).toEqual({
      hysteresis_margin_px: 8,
      poll_interval_ms: 200,
      debounce_samples: 2,
      alpha_threshold: 0.1,
    });
  });

  it("hit_test이 없으면 undefined (하위호환)", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar.hit_test).toBeUndefined();
  });

  it("부분 hit_test(일부 필드만)도 허용한다", async () => {
    const cfg = await loadWithAvatar({
      vrm_url: "/vrms/carlotta.vrm",
      hit_test: { poll_interval_ms: 150 },
    });
    expect(cfg.avatar.hit_test).toEqual({ poll_interval_ms: 150 });
  });

  it("hit_test이 객체가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: 5 }));
  });

  it("hysteresis_margin_px: 음수면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { hysteresis_margin_px: -1 } }),
    );
  });

  it("hysteresis_margin_px: 비유한이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({
        vrm_url: "/vrms/carlotta.vrm",
        hit_test: { hysteresis_margin_px: Number.NaN },
      }),
    );
  });

  it("poll_interval_ms: 0 이하면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { poll_interval_ms: 0 } }),
    );
  });

  it("debounce_samples: 정수가 아니면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { debounce_samples: 1.5 } }),
    );
  });

  it("debounce_samples: 1 미만이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { debounce_samples: 0 } }),
    );
  });

  it("alpha_threshold: (0,1] 밖이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { alpha_threshold: 1.5 } }),
    );
  });
});

// ── avatar.gaze camera tracking ─────────────────────────────────────────────────

describe("loadConfig — avatar.gaze", () => {
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

  const fullGaze = {
    deadDeg: 3,
    headEngageDeg: 20,
    disengageDeg: 65,
    maxHeadYaw: 50,
    maxHeadPitch: 30,
    eyeMaxDeg: 25,
    headNeckSplit: 0.6,
    smooth: 10,
  };

  it("유효한 gaze 전체 블록을 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf({
        ...goodFixture(),
        "avatar.json": { vrm_url: "/vrms/carlotta.vrm", gaze: fullGaze },
      }),
    });
    expect(cfg.avatar.gaze).toEqual(fullGaze);
  });

  it("gaze가 없으면 undefined (하위호환 → 렌더러 기본값)", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar.gaze).toBeUndefined();
  });

  it("부분 gaze(일부 필드만)도 허용한다", async () => {
    const cfg = await loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { disengageDeg: 70 } });
    expect((cfg as { avatar: { gaze?: unknown } }).avatar.gaze).toEqual({ disengageDeg: 70 });
  });

  it("gaze가 객체가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: 5 }));
  });

  it("deadDeg 음수면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { deadDeg: -1 } }),
    );
  });

  it("disengageDeg > 180이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { disengageDeg: 181 } }),
    );
  });

  it("eyeMaxDeg > 90이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { eyeMaxDeg: 91 } }),
    );
  });

  it("headNeckSplit이 [0,1] 밖이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { headNeckSplit: 1.2 } }),
    );
  });

  it("smooth가 0 이하면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { smooth: 0 } }));
  });

  it("maxHeadYaw가 NaN이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { maxHeadYaw: Number.NaN } }),
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

// ── chat_api (chat 프로토콜 선택) ──────────────────────────────────────────────

describe("loadConfig — endpoints chat_api", () => {
  function baseEndpoints(): Record<string, unknown> {
    return {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "openai",
    };
  }

  it("chat_api: responses를 그대로 보존한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), chat_api: "responses" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBe("responses");
  });

  it("chat_api: chat_completions를 그대로 보존한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), chat_api: "chat_completions" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBe("chat_completions");
  });

  it("chat_api이 없으면 undefined(선택, default는 상위 레이어 소관)", async () => {
    const map = goodFixture();
    map["endpoints.json"] = baseEndpoints();
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBeUndefined();
  });

  it("chat_api가 enum 밖이면 실패", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), chat_api: "sse_v2" };
    const p = loadConfig({ read: readerOf(map) });
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("endpoints.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  });
});

// ── context window ────────────────────────────────────────────────────────────

describe("loadConfig — endpoints context window", () => {
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

  it("chat_model_context_window를 명시하면 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf({
        ...goodFixture(),
        "endpoints.json": {
          ...baseEndpoints(),
          chat_model_context_window: 128000,
        },
      }),
    });
    expect(cfg.endpoints.chat_model_context_window).toBe(128000);
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
