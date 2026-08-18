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
  deltaEvent,
  makeLogger,
  makeTurnOutput,
  turnOf,
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
    await caller.call(turnOf(userEnv("오늘 일정?")));
    expect(script.spy).toHaveBeenCalledTimes(1);
    const [cfg, request] = script.spy.mock.calls[0];
    expect(cfg).toEqual(CONFIG);
    // input must be an array carrying the user text (OpenAI Responses input shape).
    const json = JSON.stringify(request.input);
    expect(json).toContain("오늘 일정?");
  });

  it("passes apiKey + fetch from the injected resolvers to streamChat opts", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    const [, , opts] = script.spy.mock.calls[0];
    expect(opts.apiKey).toBe("k");
    expect("fetch" in opts).toBe(true);
  });

  it("threads an AbortSignal through the request", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    const [, request] = script.spy.mock.calls[0];
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("env.timestamp is a local ISO 8601 string with timezone offset representing the same instant as env.ts", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const TS = 1_717_000_000_000;
    await caller.call(turnOf(userEnv("now?")));
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

describe("backend_caller — sent history", () => {
  it("appends history only after a confirmed successful turn", async () => {
    const contextHistory = { append: vi.fn() };
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      contextHistory,
    });

    script.events = [];
    await caller.call(turnOf(userEnv()));
    expect(contextHistory.append).not.toHaveBeenCalled();

    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    expect(contextHistory.append).toHaveBeenCalledOnce();
    expect(contextHistory.append).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "user.text_submitted",
        trigger_kind: "user",
        client_context: expect.objectContaining({
          env: expect.not.objectContaining({ active_window_title: expect.anything() }),
        }),
      }),
    );
  });
});

describe("backend_caller — turn record log", () => {
  it("appends one turn record per outcome, with spoke_text reflecting whether speech_text was non-empty", async () => {
    const appendTurnRecord = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      appendTurnRecord,
    });

    script.events = [completedEvent({ speech_text: "hi" })];
    await caller.call(turnOf(userEnv("안녕")));
    expect(appendTurnRecord).toHaveBeenCalledOnce();
    expect(appendTurnRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn",
        event_name: "user.text_submitted",
        trigger_kind: "user",
        spoke_text: true,
      }),
    );

    appendTurnRecord.mockClear();
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv("조용히")));
    expect(appendTurnRecord).toHaveBeenCalledOnce();
    expect(appendTurnRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn", spoke_text: false }),
    );
  });

  it("streaming path (delta drove speech, completed carries empty speech_text) → spoke_text: true", async () => {
    const appendTurnRecord = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      appendTurnRecord,
    });

    script.events = [deltaEvent("안녕"), completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv("안녕")));
    expect(appendTurnRecord).toHaveBeenCalledOnce();
    expect(appendTurnRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn", spoke_text: true }),
    );
  });

  it("does not append a turn record for a dropped/unparsed turn (no completed envelope)", async () => {
    const appendTurnRecord = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      appendTurnRecord,
    });

    script.events = [];
    const outcome = await caller.call(turnOf(userEnv()));
    expect(outcome).toBe("parse_error");
    expect(appendTurnRecord).not.toHaveBeenCalled();
  });

  it("a throwing appendTurnRecord is swallowed — the turn still completes 'ok'", async () => {
    const appendTurnRecord = vi.fn(() => {
      throw new Error("disk full");
    });
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      appendTurnRecord,
    });

    script.events = [completedEvent({ speech_text: "hi" })];
    const outcome = await caller.call(turnOf(userEnv("안녕")));
    expect(outcome).toBe("ok");
    expect(appendTurnRecord).toHaveBeenCalledOnce();
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
    await caller.call(turnOf(userEnv("이 화면 뭐야?")));
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
    await caller.call(turnOf(userEnv("그냥 텍스트")));
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
    await caller.call(turnOf(userEnv("이미지 없음")));
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
    const res = await caller.call(turnOf(userEnv("캡처 실패")));
    expect(res).toBe("ok");
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
    await caller.call(turnOf(imgEnv("이거 봐", [IMG_A, IMG_B])));
    const [, request] = script.spy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.find((p) => p.type === "input_text")?.text).toContain("이거 봐");
    const images = content.filter((p) => p.type === "input_image");
    expect(images.map((p) => p.image_url)).toEqual([IMG_A, IMG_B]);
  });

  it("image data URLs are absent from the client_context block", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(imgEnv("이거 봐", [IMG_A, IMG_B])));
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
    await caller.call(turnOf(imgEnv("둘 다", [IMG_A, IMG_B])));
    const [, request] = script.spy.mock.calls[0];
    const content = userMessageOf(request.input).content as Array<Record<string, unknown>>;
    const urls = content.filter((p) => p.type === "input_image").map((p) => p.image_url);
    expect(urls).toEqual([SHOT, IMG_A, IMG_B]);
  });

  it("no images and no screenshot → user content stays a plain string", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv("그냥 텍스트")));
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageOf(request.input).content).toContain("그냥 텍스트");
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
    await caller.call(turnOf(proactiveEnv()));
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
    await caller.call(turnOf(userEnv("진짜 텍스트")));
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
    await caller.call(turnOf(env));
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
    await caller.call(turnOf(env));
    const [, request] = script.spy.mock.calls[0];
    expect(userMessageContentOf(request.input)).toContain("こんにちは");
  });

  it("(e) getBodyState reports a posture → client_context carries body_state with posture + since", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getBodyState: () => ({
        posture: { state: "peeking", perched_on: { app: "Messages", window_title: "Alice" } },
        since: 1_716_999_000_000,
      }),
    });
    await caller.call(turnOf(proactiveEnv()));
    const [, request] = script.spy.mock.calls[0];
    expect(clientContextOf(request.input).body_state).toEqual({
      posture: { state: "peeking", perched_on: { app: "Messages", window_title: "Alice" } },
      since: 1_716_999_000_000,
    });
  });

  it("(f) getBodyState reports no posture → client_context omits body_state", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      turnOutput,
      getBodyState: () => undefined,
    });
    await caller.call(turnOf(userEnv("자유")));
    const [, request] = script.spy.mock.calls[0];
    expect("body_state" in clientContextOf(request.input)).toBe(false);
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
    await caller.call(turnOf(userEnv()));
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
    await caller.call(turnOf(userEnv()));
    const [, request] = script.spy.mock.calls[0];
    expect(request.reasoning_effort).toBe("none");
    expect("instructions" in request).toBe(false);
  });

  it("getAgentSettings absent → request carries neither (back-compat)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(turnOf(userEnv()));
    const [, request] = script.spy.mock.calls[0];
    expect("reasoning_effort" in request).toBe(false);
    expect("instructions" in request).toBe(false);
  });
});
