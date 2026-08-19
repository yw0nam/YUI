/**
 * load-endpoints.test.ts — unit tests for loadConfig endpoints.* section.
 * TTS server/model/speaker, broker_base_url, chat_api, context window.
 */

import { describe, expect, it } from "vitest";
import type { EndpointsConfig } from "../contract";
import { CONFIG_FILES, ConfigError, loadConfig } from "./load";
import { goodFixture, readerOf } from "./load-test-helpers";

// ── TTS (single OpenAI-compatible path) ───────────────────────────────────────

describe("loadConfig — endpoints TTS", () => {
  it("완전한 TTS endpoints는 모든 필드를 보존한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_model: "irodori-tts",
      tts_speaker: "ナツメ",
      tts_max_inflight: 1,
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints).toEqual({
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_model: "irodori-tts",
      tts_speaker: "ナツメ",
      tts_max_inflight: 1,
    });
  });

  it("tts_model / tts_speaker 생략은 통과한다", async () => {
    const map = goodFixture();
    map["endpoints.json"] = {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.tts_model).toBeUndefined();
    expect(cfg.endpoints.tts_speaker).toBeUndefined();
  });
});

// ── unconfigured endpoints (distribution default) ──────────────────────────────

describe("loadConfig — endpoints with no URLs", () => {
  it("boots with a URL-less endpoints.json: every service reads as unset", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { chat_endpoint: "/v1/responses", chat_api: "responses" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_base_url).toBe("");
    expect(cfg.endpoints.stt_base_url).toBe("");
    expect(cfg.endpoints.tts_base_url).toBe("");
    expect(cfg.endpoints.broker_base_url).toBeUndefined();
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

// ── chat_api (chat protocol selection) ──────────────────────────────────────────────

describe("loadConfig — endpoints chat_api", () => {
  function baseEndpoints(): Record<string, unknown> {
    return {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
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

describe("loadConfig — endpoints validation failures", () => {
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

  it("tts_base_url이 http(s) URL이 아니면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "localhost:8092", // missing scheme
      }),
    );
  });

  it("tts_model이 빈 문자열이면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_model: "",
      }),
    );
  });

  it("tts_speaker가 빈 문자열이면 실패", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_speaker: "   ",
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
        tts_max_inflight: 0,
      }),
    );
  });
});
