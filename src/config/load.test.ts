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

// ── fixtures (실제 configs/*.json 미러) ────────────────────────────────────────

/** known-good 파일 묶음. 각 테스트는 이걸 복제·일부 변형해서 쓴다. */
function goodFixture(): Record<string, unknown> {
  return {
    "endpoints.json": {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
    },
    "avatar.json": { vrm_url: "/vrms/carlotta.vrm" },
    "emotion_registry.json": {
      neutral: { vrm_expression: "neutral", fallback: "neutral" },
      happy: { vrm_expression: "happy", fallback: "neutral" },
    },
    "emotion_tts_prefix.json": {
      _version: "v1",
      _status: "TBD — 발명 금지.",
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
    });
    expect(cfg.avatar).toEqual({ vrm_url: "/vrms/carlotta.vrm" });
    expect(cfg.emotionRegistry.happy).toEqual({
      vrm_expression: "happy",
      fallback: "neutral",
    });
    expect(cfg.emotionTtsPrefix._version).toBe("v1");
    expect(cfg.emotionTtsPrefix._status).toContain("TBD");
    // 모션 5섹션 중 하나 — registry default가 진실의 원천.
    expect(Object.keys(cfg.motions)).toEqual(["idle", "drag", "sit"]);
    expect(cfg.motions.sit.interrupt_policy).toBe("queue");
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

  it("avatar: vrm_url 누락 시 실패", async () => {
    await expectConfigError(loadWith(CONFIG_FILES.avatar, {}), "avatar.json");
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

  it("emotion_registry: contract enum 밖의 키면 실패(오탈자 fail-loud)", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.emotionRegistry, {
        hapy: { vrm_expression: "happy", fallback: "neutral" }, // 오탈자
      }),
      "emotion_registry.json",
    );
  });

  it("emotion_tts_prefix: _status 누락 시 실패", async () => {
    await expectConfigError(
      loadWith(CONFIG_FILES.emotionTtsPrefix, { _version: "v1" }),
      "emotion_tts_prefix.json",
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
