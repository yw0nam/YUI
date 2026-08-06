/**
 * backend-caller.context.test.ts — input context assembly (package_context, ports, client_context envelope, agent settings).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts; the
 * chat stream is injected per caller from the shared scripted fixture (BackendCallerDeps.stream).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { InputContext, ToolStatus, Usage } from "../contract";
import type { Logger } from "../logger";
import { type BackendCaller, createBackendCaller } from "./backend-caller";
import type { BusEnvelope } from "./event-bus";
import {
  CONFIG,
  clientContextJsonOf,
  completedEvent,
  createScriptedStream,
  makeLogger,
  makeTurnOutput,
  userEnv,
} from "./test-helpers";

const script = createScriptedStream();
let applyDirective: ReturnType<typeof vi.fn>;
let turnOutput: ReturnType<typeof makeTurnOutput>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let usageSink: Mock<(usage: Usage) => void>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  script.reset();
  applyDirective = vi.fn();
  turnOutput = makeTurnOutput();
  toolStatusSink = vi.fn();
  usageSink = vi.fn();
  logger = makeLogger();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    stream: script.stream,
    turnOutput,
    onToolStatus: toolStatusSink,
    onUsage: usageSink,
    logger,
  });
});

describe("backend_caller — B1 package_context (contract §4 InputContext)", () => {
  it("builds InputContext with user_text + env.timestamp + env.timezone and passes it to streamChat", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("오늘 일정?"));
    expect(script.spy).toHaveBeenCalledTimes(1);
    const [cfg, request] = script.spy.mock.calls[0];
    expect(cfg).toEqual(CONFIG);
    // input must be an array carrying the user text (OpenAI Responses input shape).
    const json = JSON.stringify(request.input);
    expect(json).toContain("오늘 일정?");
  });

  it("passes apiKey + fetch from the injected resolvers to streamChat opts", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, , opts] = script.spy.mock.calls[0];
    expect(opts.apiKey).toBe("k");
    expect("fetch" in opts).toBe(true);
  });

  it("threads an AbortSignal through the request", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("env.timestamp is a local ISO 8601 string with timezone offset representing the same instant as env.ts", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const TS = 1_717_000_000_000;
    await caller.call(userEnv("now?"));
    const [, request] = script.spy.mock.calls[0];
    const items = request.input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    const ctx = JSON.parse(clientContextJsonOf(user.content)) as {
      env: { timestamp: string };
    };
    const ts = ctx.env.timestamp;
    // local wall-clock form with explicit ±HH:MM offset (not UTC "…Z").
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // combined with its offset it must denote the same instant as env.ts.
    expect(new Date(ts).getTime()).toBe(TS);
  });
});

describe("backend_caller — context policy and sent history", () => {
  it("does not peek or drain recent apps while the signal is disabled", async () => {
    const peekRecentApps = vi.fn(() => [{ name: "Code", ts: Date.now() }]);
    const drainRecentApps = vi.fn();
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      getContextPolicy: () => ({
        recent_apps: false,
        active_app: true,
        active_window_title: true,
        posture: true,
        screenshot: true,
      }),
      peekRecentApps,
      drainRecentApps,
    });

    await caller.call(userEnv());

    expect(peekRecentApps).not.toHaveBeenCalled();
    expect(drainRecentApps).not.toHaveBeenCalled();
  });

  it("appends history only after a confirmed successful turn", async () => {
    const contextHistory = { append: vi.fn() };
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      getContextPolicy: () => ({
        recent_apps: true,
        active_app: true,
        active_window_title: false,
        posture: true,
        screenshot: true,
      }),
      getOsContext: () => ({ activeApp: "Code", activeWindowTitle: "secret" }),
      contextHistory,
    });

    script.events = [];
    await caller.call(userEnv());
    expect(contextHistory.append).not.toHaveBeenCalled();

    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    expect(contextHistory.append).toHaveBeenCalledOnce();
    expect(contextHistory.append).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "user.text_submitted",
        trigger_kind: "user",
        included: ["active_app"],
        excluded: ["active_window_title"],
        client_context: expect.objectContaining({
          env: expect.not.objectContaining({ active_window_title: expect.anything() }),
        }),
      }),
    );
  });
});

describe("backend_caller — screenshot port", () => {
  const SCREENSHOT: NonNullable<InputContext["screenshot"]> = {
    enabled: true,
    source: { kind: "monitor", index: 0 },
    data_url: "data:image/png;base64,AAA",
  };

  /** find the user message in the input passed to streamChat. */
  function userMessageOf(input: unknown): { role: string; content: unknown } {
    const items = input as Array<{ role: string; content: unknown }>;
    return items.find((m) => m.role === "user")!;
  }

  it("getScreenshot block → user content is array with input_text + input_image (data_url)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getScreenshot: async () => SCREENSHOT,
    });
    await caller.call(userEnv("이 화면 뭐야?"));
    const [, request] = script.spy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    const textPart = content.find((p) => p.type === "input_text");
    expect(textPart?.text).toContain("이 화면 뭐야?");
    const imagePart = content.find((p) => p.type === "input_image");
    expect(imagePart?.image_url).toBe("data:image/png;base64,AAA");
  });

  it("getScreenshot omitted → user content is a plain string (unchanged)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("그냥 텍스트"));
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageOf(request.input).content).toContain("그냥 텍스트");
  });

  it("getScreenshot resolves undefined → user content is a plain string (no image part)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getScreenshot: async () => undefined,
    });
    await caller.call(userEnv("이미지 없음"));
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageOf(request.input).content).toContain("이미지 없음");
  });

  it("getScreenshot rejects → turn still proceeds without an image (reaches streamChat)", async () => {
    script.events = [completedEvent({ speech_text: "hi" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getScreenshot: async () => {
        throw new Error("capture failed");
      },
    });
    const res = await caller.call(userEnv("캡처 실패"));
    expect(res.ok).toBe(true);
    expect(script.spy).toHaveBeenCalledTimes(1);
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageOf(request.input).content).toContain("캡처 실패");
  });
});

describe("backend_caller — user_images (chat attachments)", () => {
  const IMG_A = "data:image/png;base64,AAA";
  const IMG_B = "data:image/jpeg;base64,BBB";

  /** find the user message in the input passed to streamChat. */
  function userMessageOf(input: unknown): { role: string; content: unknown } {
    const items = input as Array<{ role: string; content: unknown }>;
    return items.find((m) => m.role === "user")!;
  }

  /** the input_text part of the user message passed to streamChat. */
  function userTextPartOf(input: unknown): string {
    const content = userMessageOf(input).content as Array<Record<string, unknown>>;
    return content.find((p) => p.type === "input_text")!.text as string;
  }

  function imgEnv(text: string, images: string[]): BusEnvelope {
    return { ...userEnv(text), payload: { text, images } };
  }

  it("payload.images → user content carries one input_image part per image + input_text", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(imgEnv("이거 봐", [IMG_A, IMG_B]));
    const [, request] = script.spy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.find((p) => p.type === "input_text")?.text).toContain("이거 봐");
    const images = content.filter((p) => p.type === "input_image");
    expect(images.map((p) => p.image_url)).toEqual([IMG_A, IMG_B]);
  });

  it("image data URLs are absent from the client_context block", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(imgEnv("이거 봐", [IMG_A, IMG_B]));
    const [, request] = script.spy.mock.calls[0];
    const json = clientContextJsonOf(userTextPartOf(request.input));
    expect(json).not.toContain(IMG_A);
    expect(json).not.toContain(IMG_B);
  });

  it("screenshot + user_images together → screenshot part AND all user image parts present", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const SHOT = "data:image/png;base64,SHOT";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getScreenshot: async () => ({
        enabled: true,
        source: { kind: "monitor", index: 0 },
        data_url: SHOT,
      }),
    });
    await caller.call(imgEnv("둘 다", [IMG_A, IMG_B]));
    const [, request] = script.spy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    const urls = content.filter((p) => p.type === "input_image").map((p) => p.image_url);
    expect(urls).toEqual([SHOT, IMG_A, IMG_B]);
  });

  it("no images and no screenshot → user content stays a plain string", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("그냥 텍스트"));
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageOf(request.input).content).toContain("그냥 텍스트");
  });
});

describe("backend_caller — os context port", () => {
  /** decode the flat ClientContext from the tagged block in the user message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  it("getOsContext snapshot → env.active_app + env.active_window_title attached", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getOsContext: () => ({ activeApp: "Visual Studio Code", activeWindowTitle: "main.ts" }),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect(env.active_app).toEqual({ name: "Visual Studio Code" });
    expect(env.active_window_title).toBe("main.ts");
  });

  it("getOsContext absent → env.active_app / active_window_title omitted", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });

  it("getOsContext returns {} → env.active_app / active_window_title omitted", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getOsContext: () => ({}),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });
});

describe("backend_caller — posture context port", () => {
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  it("attaches the current posture to env", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getPosture: () => ({
        state: "sitting",
        perched_on: { app: "Notes", window_title: "Meeting notes" },
      }),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    expect((ctx.env as Record<string, unknown>).posture).toEqual({
      state: "sitting",
      perched_on: { app: "Notes", window_title: "Meeting notes" },
    });
  });

  it("omits posture from env while idle", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getPosture: () => undefined,
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    expect("posture" in (ctx.env as Record<string, unknown>)).toBe(false);
  });
});

describe("backend_caller — recent apps package (peek, non-destructive)", () => {
  /** decode the flat ClientContext from the tagged block in the user message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  it("peekRecentApps stub → env.recent_apps included as names only", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const peekRecentApps = vi.fn(() => [
      { name: "Visual Studio Code", ts: 1_717_000_000_000 },
      { name: "Slack", ts: 1_717_000_001_000 },
    ]);
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      peekRecentApps,
    });
    await caller.call(userEnv());
    expect(peekRecentApps).toHaveBeenCalledTimes(1);
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect(env.recent_apps).toEqual([{ name: "Visual Studio Code" }, { name: "Slack" }]);
  });

  it("peekRecentApps returns [] → env.recent_apps omitted", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      peekRecentApps: () => [],
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("recent_apps" in env).toBe(false);
  });

  it("peekRecentApps absent → env.recent_apps omitted", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("recent_apps" in env).toBe(false);
  });
});

describe("backend_caller — recent apps commit (drain only on confirmed success)", () => {
  it("setup-stage reject (getApiKey throws) → drainRecentApps is never called (no loss)", async () => {
    const peekRecentApps = vi.fn(() => [{ name: "Visual Studio Code", ts: 1_717_000_000_000 }]);
    const drainRecentApps = vi.fn(() => [{ name: "Visual Studio Code", ts: 1_717_000_000_000 }]);
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => {
        throw new Error("secret resolve failed");
      },
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      peekRecentApps,
      drainRecentApps,
    });
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    // packageContext still peeked (best-effort attach attempted before the failure)…
    expect(peekRecentApps).toHaveBeenCalledTimes(1);
    // …but the buffer must never be cleared on a client-side failure — no loss.
    expect(drainRecentApps).not.toHaveBeenCalled();
  });

  it("no completed event (parse_error) → drainRecentApps is never called", async () => {
    const drainRecentApps = vi.fn(() => []);
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      drainRecentApps,
    });
    script.events = [{ type: "speech_delta", text: "x" }];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("parse_error");
    expect(drainRecentApps).not.toHaveBeenCalled();
  });

  it("a thrown stream (network_drop) → drainRecentApps is never called", async () => {
    const drainRecentApps = vi.fn(() => []);
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      drainRecentApps,
    });
    script.error = new Error("boom");
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(false);
    expect(res.drop_reason).toBe("network_drop");
    expect(drainRecentApps).not.toHaveBeenCalled();
  });

  it("confirmed success (completed received, post-stream guards pass) → buffer drained exactly once, after peek", async () => {
    const calls: string[] = [];
    const peekRecentApps = vi.fn(() => {
      calls.push("peek");
      return [{ name: "Visual Studio Code", ts: 1_717_000_000_000 }];
    });
    const drainRecentApps = vi.fn(() => {
      calls.push("drain");
      return [{ name: "Visual Studio Code", ts: 1_717_000_000_000 }];
    });
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      peekRecentApps,
      drainRecentApps,
    });
    script.events = [completedEvent({ speech_text: "" })];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(peekRecentApps).toHaveBeenCalledTimes(1);
    expect(drainRecentApps).toHaveBeenCalledTimes(1);
    // packaging (peek) happens before the buffer is committed/cleared (drain).
    expect(calls).toEqual(["peek", "drain"]);
  });
});

describe("backend_caller — flat client_context envelope", () => {
  /** decode the flat ClientContext { env, trigger, screenshot? } from the user message block. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  function userMessageContentOf(input: unknown): unknown {
    const items = input as Array<{ role: string; content: unknown }>;
    return items.find((m) => m.role === "user")!.content;
  }

  function proactiveEnv(): BusEnvelope {
    return {
      seq_id: 7,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { os_idle_ms: 65_000, gap_ms: 3_900_000 },
    };
  }

  it("(a) proactive envelope → flat trigger with kind/idle_elapsed_min; NO input_context/dispatcher_state; user message is proactive marker", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(proactiveEnv());
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    // top-level keys: env + trigger only (no input_context, no dispatcher_state)
    expect("input_context" in ctx).toBe(false);
    expect("dispatcher_state" in ctx).toBe(false);
    // trigger must have kind derived from event_name
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("proactive");
    // idle_elapsed_min = round(3_900_000 / 60000) = 65
    expect(trigger.idle_elapsed_min).toBe(65);
    // no raw event_name/source/ts/seq_id on trigger
    expect("event_name" in trigger).toBe(false);
    expect("source" in trigger).toBe(false);
    expect("ts" in trigger).toBe(false);
    expect("seq_id" in trigger).toBe(false);
    // proactive turn (no user_text) → proactive background marker string
    expect(userMessageContentOf(request.input)).toContain("(I've gone quiet for a while)");
  });

  it("(b) user turn → trigger.kind is 'user'; env has timestamp/timezone; no user_text in system object", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("진짜 텍스트"));
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("user");
    expect("idle_elapsed_min" in trigger).toBe(false);
    // env has timestamp + timezone
    const env = ctx.env as Record<string, unknown>;
    expect(typeof env.timestamp).toBe("string");
    expect(typeof env.timezone).toBe("string");
    // NO user text in system object anywhere
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("진짜 텍스트");
    // user text appears in the user-role message
    expect(userMessageContentOf(request.input)).toContain("진짜 텍스트");
  });

  it("(c) schedule envelope → trigger.kind is 'schedule'", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 5,
      source: "timer_scheduler",
      event_name: "schedule.morning",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("schedule");
    expect("idle_elapsed_min" in trigger).toBe(false);
  });

  it("(d) voice envelope → user message content is the STT transcript text, not the proactive marker", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 9,
      source: "user_input_source",
      event_name: "user.voice_segment_ready",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      dnd_override: true,
      payload: { text: "こんにちは" },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageContentOf(request.input)).toContain("こんにちは");
  });
});

describe("backend_caller — agent settings (reasoning effort + instructions)", () => {
  it("getAgentSettings present → reasoning_effort + instructions threaded into ChatRequest", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getAgentSettings: () => ({ reasoning_effort: "medium", instructions: "be terse" }),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect(request.reasoning_effort).toBe("medium");
    expect(request.instructions).toBe("be terse");
  });

  it("getAgentSettings 'none' → reasoning_effort always sent; empty instructions omitted", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getAgentSettings: () => ({ reasoning_effort: "none", instructions: "" }),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect(request.reasoning_effort).toBe("none");
    expect("instructions" in request).toBe(false);
  });

  it("getAgentSettings absent → request carries neither (back-compat)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect("reasoning_effort" in request).toBe(false);
    expect("instructions" in request).toBe(false);
  });
});
