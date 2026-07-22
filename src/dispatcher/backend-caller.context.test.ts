/**
 * backend-caller.context.test.ts — input context assembly (package_context, ports, client_context envelope, agent settings).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts;
 * the streamChat mock + mutable scripted-event state + sinks stay file-local (vitest vi.mock
 * is file-scoped and reads module-mutable state the test bodies reassign).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ExpressArgs, InputContext, ToolStatus, Usage } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { Logger } from "../logger";
import type { BusEnvelope } from "./event-bus";
import { CONFIG, completedEvent, makeLogger, userEnv } from "./test-helpers";

let scriptedEvents: ChatStreamEvent[] = [];
let streamChatError: Error | null = null;
// per-event delay (ms) before yielding scriptedEvents[i], parallel array (default 0).
let scriptedGaps: number[] = [];
// index at which the stream hangs forever (never yields/throws again) — models a stall.
// 0 = hangs before the first event (no first byte / TTFT stall).
let hangAtIndex: number | null = null;
const streamChatSpy = vi.fn();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock("../io/chat-client", () => ({
  async *streamChat(...args: unknown[]) {
    streamChatSpy(...args);
    for (let i = 0; i < scriptedEvents.length; i++) {
      if (hangAtIndex === i) await sleep(2 ** 31 - 1); // never resolves in practice
      const gap = scriptedGaps[i] ?? 0;
      if (gap > 0) await sleep(gap);
      yield scriptedEvents[i];
    }
    if (hangAtIndex === scriptedEvents.length) await sleep(2 ** 31 - 1);
    // yield scripted events first, then throw — models a stream that drops mid-flight.
    if (streamChatError) throw streamChatError;
  },
}));

import { type BackendCaller, createBackendCaller } from "./backend-caller";

let applyDirective: ReturnType<typeof vi.fn>;
let speechSink: Mock<(text: string) => void>;
let cueSink: Mock<(cue: ExpressArgs) => void>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let speechDeltaSink: Mock<(text: string) => void>;
let speechEndSink: Mock<() => void>;
let speechInterruptSink: Mock<() => void>;
let speechAbortSink: Mock<() => void>;
let usageSink: Mock<(usage: Usage) => void>;
let caller: BackendCaller;
let logger: Logger;

beforeEach(() => {
  scriptedEvents = [];
  streamChatError = null;
  scriptedGaps = [];
  hangAtIndex = null;
  streamChatSpy.mockClear();
  applyDirective = vi.fn();
  speechSink = vi.fn();
  cueSink = vi.fn();
  toolStatusSink = vi.fn();
  speechDeltaSink = vi.fn();
  speechEndSink = vi.fn();
  speechInterruptSink = vi.fn();
  speechAbortSink = vi.fn();
  usageSink = vi.fn();
  logger = makeLogger();
  caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    onSpeech: speechSink,
    onCue: cueSink,
    onToolStatus: toolStatusSink,
    onSpeechDelta: speechDeltaSink,
    onSpeechEnd: speechEndSink,
    onSpeechInterrupt: speechInterruptSink,
    onSpeechAbort: speechAbortSink,
    onUsage: usageSink,
    logger,
  });
});

describe("backend_caller — B1 package_context (contract §4 InputContext)", () => {
  it("builds InputContext with user_text + env.timestamp + env.timezone and passes it to streamChat", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("오늘 일정?"));
    expect(streamChatSpy).toHaveBeenCalledTimes(1);
    const [cfg, request] = streamChatSpy.mock.calls[0];
    expect(cfg).toEqual(CONFIG);
    // input must be an array carrying the user text (OpenAI Responses input shape).
    const json = JSON.stringify(request.input);
    expect(json).toContain("오늘 일정?");
  });

  it("passes apiKey + fetch from the injected resolvers to streamChat opts", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, , opts] = streamChatSpy.mock.calls[0];
    expect(opts.apiKey).toBe("k");
    expect("fetch" in opts).toBe(true);
  });

  it("threads an AbortSignal through the request", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("env.timestamp is a local ISO 8601 string with timezone offset representing the same instant as env.ts", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const TS = 1_717_000_000_000;
    await caller.call(userEnv("now?"));
    const [, request] = streamChatSpy.mock.calls[0];
    const items = request.input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const ctx = JSON.parse(sys.content.replace(/^client_context:\s*/, "")) as {
      env: { timestamp: string };
    };
    const ts = ctx.env.timestamp;
    // local wall-clock form with explicit ±HH:MM offset (not UTC "…Z").
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // combined with its offset it must denote the same instant as env.ts.
    expect(new Date(ts).getTime()).toBe(TS);
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
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => SCREENSHOT,
    });
    await caller.call(userEnv("이 화면 뭐야?"));
    const [, request] = streamChatSpy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    const textPart = content.find((p) => p.type === "input_text");
    expect(textPart?.text).toBe("이 화면 뭐야?");
    const imagePart = content.find((p) => p.type === "input_image");
    expect(imagePart?.image_url).toBe("data:image/png;base64,AAA");
  });

  it("getScreenshot omitted → user content is a plain string (unchanged)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("그냥 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("그냥 텍스트");
  });

  it("getScreenshot resolves undefined → user content is a plain string (no image part)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => undefined,
    });
    await caller.call(userEnv("이미지 없음"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("이미지 없음");
  });

  it("getScreenshot rejects → turn still proceeds without an image (reaches streamChat)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "hi" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => {
        throw new Error("capture failed");
      },
    });
    const res = await caller.call(userEnv("캡처 실패"));
    expect(res.ok).toBe(true);
    expect(streamChatSpy).toHaveBeenCalledTimes(1);
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("캡처 실패");
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

  /** the raw system message string passed to streamChat. */
  function systemStringOf(input: unknown): string {
    const items = input as Array<{ role: string; content: string }>;
    return items.find((m) => m.role === "system")!.content;
  }

  function imgEnv(text: string, images: string[]): BusEnvelope {
    return { ...userEnv(text), payload: { text, images } };
  }

  it("payload.images → user content carries one input_image part per image + input_text", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(imgEnv("이거 봐", [IMG_A, IMG_B]));
    const [, request] = streamChatSpy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.find((p) => p.type === "input_text")?.text).toBe("이거 봐");
    const images = content.filter((p) => p.type === "input_image");
    expect(images.map((p) => p.image_url)).toEqual([IMG_A, IMG_B]);
  });

  it("image data URLs are absent from the system client_context string", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(imgEnv("이거 봐", [IMG_A, IMG_B]));
    const [, request] = streamChatSpy.mock.calls[0];
    const sys = systemStringOf(request.input);
    expect(sys).not.toContain(IMG_A);
    expect(sys).not.toContain(IMG_B);
  });

  it("screenshot + user_images together → screenshot part AND all user image parts present", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const SHOT = "data:image/png;base64,SHOT";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getScreenshot: async () => ({
        enabled: true,
        source: { kind: "monitor", index: 0 },
        data_url: SHOT,
      }),
    });
    await caller.call(imgEnv("둘 다", [IMG_A, IMG_B]));
    const [, request] = streamChatSpy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    const urls = content.filter((p) => p.type === "input_image").map((p) => p.image_url);
    expect(urls).toEqual([SHOT, IMG_A, IMG_B]);
  });

  it("no images and no screenshot → user content stays a plain string", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("그냥 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageOf(request.input).content).toBe("그냥 텍스트");
  });
});

describe("backend_caller — os context port", () => {
  /** decode the flat ClientContext from the system message passed to streamChat. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
  }

  it("getOsContext snapshot → env.active_app + env.active_window_title attached", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getOsContext: () => ({ activeApp: "Visual Studio Code", activeWindowTitle: "main.ts" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect(env.active_app).toEqual({ name: "Visual Studio Code" });
    expect(env.active_window_title).toBe("main.ts");
  });

  it("getOsContext absent → env.active_app / active_window_title omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });

  it("getOsContext returns {} → env.active_app / active_window_title omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getOsContext: () => ({}),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("active_app" in env).toBe(false);
    expect("active_window_title" in env).toBe(false);
  });
});

describe("backend_caller — recent apps package (peek, non-destructive)", () => {
  /** decode the flat ClientContext from the system message passed to streamChat. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
  }

  it("peekRecentApps stub → env.recent_apps included as name+local ISO timestamp", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const peekRecentApps = vi.fn(() => [
      { name: "Visual Studio Code", ts: 1_717_000_000_000 },
      { name: "Slack", ts: 1_717_000_001_000 },
    ]);
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      peekRecentApps,
    });
    await caller.call(userEnv());
    expect(peekRecentApps).toHaveBeenCalledTimes(1);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect(env.recent_apps).toEqual([
      { name: "Visual Studio Code", at: expect.any(String) },
      { name: "Slack", at: expect.any(String) },
    ]);
  });

  it("peekRecentApps returns [] → env.recent_apps omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      peekRecentApps: () => [],
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const env = ctx.env as Record<string, unknown>;
    expect("recent_apps" in env).toBe(false);
  });

  it("peekRecentApps absent → env.recent_apps omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
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
      onSpeech: speechSink,
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
      onSpeech: speechSink,
      drainRecentApps,
    });
    scriptedEvents = [{ type: "speech_delta", text: "x" }];
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
      onSpeech: speechSink,
      drainRecentApps,
    });
    streamChatError = new Error("boom");
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
      onSpeech: speechSink,
      peekRecentApps,
      drainRecentApps,
    });
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const res = await caller.call(userEnv());
    expect(res.ok).toBe(true);
    expect(peekRecentApps).toHaveBeenCalledTimes(1);
    expect(drainRecentApps).toHaveBeenCalledTimes(1);
    // packaging (peek) happens before the buffer is committed/cleared (drain).
    expect(calls).toEqual(["peek", "drain"]);
  });
});

describe("backend_caller — flat client_context envelope", () => {
  /** decode the flat ClientContext { env, trigger, screenshot? } from the system message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const sys = items.find((m) => m.role === "system")!;
    const json = sys.content.replace(/^client_context:\s*/, "");
    return JSON.parse(json);
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
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(proactiveEnv());
    const [, request] = streamChatSpy.mock.calls[0];
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
    expect(userMessageContentOf(request.input)).toBe("(the user has gone quiet on me for a while)");
  });

  it("(b) user turn → trigger.kind is 'user'; env has timestamp/timezone; no user_text in system object", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("진짜 텍스트"));
    const [, request] = streamChatSpy.mock.calls[0];
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
    expect(userMessageContentOf(request.input)).toBe("진짜 텍스트");
  });

  it("(c) schedule envelope → trigger.kind is 'schedule'", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 5,
      source: "timer_scheduler",
      event_name: "schedule.morning",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
    const [, request] = streamChatSpy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("schedule");
    expect("idle_elapsed_min" in trigger).toBe(false);
  });

  it("(d) voice envelope → user message content is the STT transcript text, not the proactive marker", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
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
    const [, request] = streamChatSpy.mock.calls[0];
    expect(userMessageContentOf(request.input)).toBe("こんにちは");
  });
});

describe("backend_caller — agent settings (reasoning effort + instructions)", () => {
  it("getAgentSettings present → reasoning_effort + instructions threaded into ChatRequest", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "medium", instructions: "be terse" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.reasoning_effort).toBe("medium");
    expect(request.instructions).toBe("be terse");
  });

  it("getAgentSettings 'none' → reasoning_effort always sent; empty instructions omitted", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "none", instructions: "" }),
    });
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect(request.reasoning_effort).toBe("none");
    expect("instructions" in request).toBe(false);
  });

  it("getAgentSettings absent → request carries neither (back-compat)", async () => {
    scriptedEvents = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = streamChatSpy.mock.calls[0];
    expect("reasoning_effort" in request).toBe(false);
    expect("instructions" in request).toBe(false);
  });
});
