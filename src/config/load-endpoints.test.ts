/**
 * load-endpoints.test.ts — unit tests for loadConfig endpoints.* section.
 * TTS server/model/speaker, broker_base_url, chat_api, context window.
 */

import { describe, expect, it } from "vitest";
import type { EndpointsConfig } from "../contract";
import { CONFIG_FILES, loadConfig } from "./load";
import { goodFixture, readerOf } from "./load-test-helpers";
import { ConfigError } from "./validators/shared";

// ── TTS (single OpenAI-compatible path) ───────────────────────────────────────

describe("loadConfig — endpoints TTS", () => {
  it("a complete TTS endpoints object preserves every field", async () => {
    const map = goodFixture();
    map["endpoints.json"] = {
      chat_base_url: "http://localhost:8642",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "irodori",
      tts_model: "irodori-tts",
      tts_speaker: "ナツメ",
      tts_max_inflight: 1,
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints).toEqual({
      chat_base_url: "http://localhost:8642",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      tts_provider: "irodori",
      tts_model: "irodori-tts",
      tts_speaker: "ナツメ",
      tts_max_inflight: 1,
    });
  });

  it("omitting tts_model / tts_speaker passes", async () => {
    const map = goodFixture();
    map["endpoints.json"] = {
      chat_base_url: "http://localhost:8642",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.tts_provider).toBeUndefined();
    expect(cfg.endpoints.tts_model).toBeUndefined();
    expect(cfg.endpoints.tts_speaker).toBeUndefined();
  });
});

// ── unconfigured endpoints (distribution default) ──────────────────────────────

describe("loadConfig — endpoints with no URLs", () => {
  it("boots with a URL-less endpoints.json: every service reads as unset", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { chat_api: "responses" };
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
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
    };
  }

  it("preserves a valid broker_base_url in the output", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), broker_base_url: "http://localhost:3201/mcp" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.broker_base_url).toBe("http://localhost:3201/mcp");
  });

  it("undefined when broker_base_url is missing (optional)", async () => {
    const map = goodFixture();
    map["endpoints.json"] = baseEndpoints();
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.broker_base_url).toBeUndefined();
  });

  it("fails when broker_base_url is not an http(s) URL", async () => {
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
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
    };
  }

  it("chat_api: preserves responses as-is", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), chat_api: "responses" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBe("responses");
  });

  it("chat_api: preserves chat_completions as-is", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), chat_api: "chat_completions" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBe("chat_completions");
  });

  it("chat_api: preserves push as-is", async () => {
    const map = goodFixture();
    map["endpoints.json"] = { ...baseEndpoints(), chat_api: "push" };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBe("push");
  });

  it("undefined when chat_api is missing (optional; the default belongs to the layer above)", async () => {
    const map = goodFixture();
    map["endpoints.json"] = baseEndpoints();
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.endpoints.chat_api).toBeUndefined();
  });

  it("fails when chat_api is outside the enum", async () => {
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

  it("preserves chat_model_context_window as-is when given", async () => {
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

  it("chat_model_context_window is undefined when missing (optional)", async () => {
    const cfg = await loadWith(baseEndpoints());
    const ep = (cfg as { endpoints: EndpointsConfig }).endpoints;
    expect(ep.chat_model_context_window).toBeUndefined();
  });

  it("fails when chat_model_context_window is 0 or less", async () => {
    await expectEndpointsError(loadWith({ ...baseEndpoints(), chat_model_context_window: 0 }));
  });

  it("fails when chat_model_context_window is non-finite (Infinity)", async () => {
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

  it("fails when tts_base_url is not an http(s) URL", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "localhost:8092", // missing scheme
      }),
    );
  });

  it("fails when tts_model is an empty string", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_model: "",
      }),
    );
  });

  it("fails when tts_speaker is an empty string", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_speaker: "   ",
      }),
    );
  });

  it("fails when tts_max_inflight is below 1", async () => {
    await expectEndpointsError(
      loadWith({
        chat_base_url: "http://localhost:8642",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
        tts_max_inflight: 0,
      }),
    );
  });
});
