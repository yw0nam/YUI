/**
 * backend-caller.request.test.ts — request shaping (previous_response_id, trigger forwarding, CC mode).
 *
 * Split from backend-caller.test.ts. Shared stateless fixtures live in ./test-helpers.ts; the
 * chat stream is injected per caller from the shared scripted fixture (BackendCallerDeps.stream).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { EndpointsConfig, ExpressArgs, ToolStatus, Usage } from "../contract";
import type { ChatHistoryEntry } from "../io/chat-history-store";
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
  userEnv,
} from "./test-helpers";

const script = createScriptedStream();
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
  script.reset();
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
    stream: script.stream,
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

describe("backend_caller — previous_response_id threading", () => {
  it("getPreviousResponseId present → request.previous_response_id carries it", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      getPreviousResponseId: () => "resp_prev",
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect(request.previous_response_id).toBe("resp_prev");
  });

  it("getPreviousResponseId returns undefined → no previous_response_id (first turn)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      getPreviousResponseId: () => undefined,
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect("previous_response_id" in request).toBe(false);
  });

  it("getPreviousResponseId absent → no previous_response_id (back-compat)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect("previous_response_id" in request).toBe(false);
  });

  it("successful completed turn → onResponseId called once with the completed responseId", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      getPreviousResponseId: () => undefined,
      onResponseId,
    });
    script.events = [completedEvent({ speech_text: "hi" }, "resp_123")];
    await caller.call(userEnv());
    expect(onResponseId).toHaveBeenCalledTimes(1);
    expect(onResponseId).toHaveBeenCalledWith("resp_123");
  });

  it("aborted turn → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    const ac = new AbortController();
    ac.abort();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      onResponseId,
    });
    script.events = [completedEvent({ speech_text: "hi" }, "resp_123")];
    await caller.call(userEnv(), ac.signal);
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("error event turn → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      onResponseId,
    });
    script.events = [{ type: "error", message: "boom" }];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("no completed envelope (parse_error) → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      onResponseId,
    });
    script.events = [deltaEvent("x")];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });

  it("R2 race: previous id changed mid-stream (reset) → onResponseId NOT called", async () => {
    const onResponseId = vi.fn();
    let current: string | undefined = "resp_prev";
    caller = createBackendCaller({
      config: CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      // settings-window reset rotates the id while the turn is in flight.
      getPreviousResponseId: () => current,
      onResponseId,
    });
    // The reset lands via onSpeech (any callback firing before the post-stream snapshot check
    // works — single-threaded, so there's no TOCTOU window): start-time id "resp_prev" no longer
    // matches at completion, so the dead turn's id must not overwrite the rotated store.
    speechSink.mockImplementation(() => {
      current = "resp_rotated";
    });
    script.events = [completedEvent({ speech_text: "hi" }, "resp_123")];
    await caller.call(userEnv());
    expect(onResponseId).not.toHaveBeenCalled();
  });
});

// ── cue context forwarding (schedule / proactive payloads → trigger.cue) ──────

describe("backend_caller — cue context forwarding (trigger.cue)", () => {
  /** decode the flat ClientContext from the tagged block in the user message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  it("(a) schedule envelope with cue → trigger.cue has label/context/local_time, NO id; schedule user message is proactive marker", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 10,
      source: "timer_scheduler",
      event_name: "schedule.morning",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        cue_id: "morning",
        label: "아침",
        context: "아침 인사 + 오늘 일정 리마인드",
        local_time: "09:00",
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("schedule");
    expect(trigger.cue).toEqual({
      label: "아침",
      context: "아침 인사 + 오늘 일정 리마인드",
      local_time: "09:00",
    });
    // no id on cue
    expect((trigger.cue as Record<string, unknown>).id).toBeUndefined();
    expect((trigger.cue as Record<string, unknown>).idle_min).toBeUndefined();
    // idle_elapsed_min absent (no gap_ms on this envelope)
    expect("idle_elapsed_min" in trigger).toBe(false);
    // user message is the schedule background marker (no user text for schedule/proactive)
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(it's the time of day you check in on me)");
  });

  it("(b) proactive envelope with cue → trigger.cue has label/context/idle_min, NO id/local_time; idle_elapsed_min on trigger", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 11,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        cue_id: "cowork",
        label: "코워킹",
        context: "집중 근무 중 따뜻하게 말 걸기",
        idle_min: 10,
        gap_ms: 3_600_000,
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("proactive");
    expect(trigger.cue).toEqual({
      label: "코워킹",
      context: "집중 근무 중 따뜻하게 말 걸기",
      idle_min: 10,
    });
    expect((trigger.cue as Record<string, unknown>).id).toBeUndefined();
    expect((trigger.cue as Record<string, unknown>).local_time).toBeUndefined();
    // idle_elapsed_min = round(3_600_000 / 60000) = 60
    expect(trigger.idle_elapsed_min).toBe(60);
  });

  it("label-only touch cue → trigger.cue carries the label and no context", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 15,
      source: "os_event_watcher",
      event_name: "proactive.touch_chest",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { cue_id: "touch_chest", label: "chest poked" },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.cue).toEqual({ label: "chest poked" });
  });

  it("proactive.touch_* user message is the touch marker (not the idle marker)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 13,
      source: "os_event_watcher",
      event_name: "proactive.touch_chest",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { cue_id: "touch_chest", label: "chest poked", context: "poked" },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(I just poked you)");
  });

  it.each([
    ["proactive.drag_held", "(I keep dragging you around)"],
    ["proactive.window_sit", "(I just sat you down on a window's edge)"],
    ["proactive.peek", "(I left you peeking out from the screen edge)"],
  ] as const)("%s user message is its reflex-gesture marker", async (eventName, marker) => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 14,
      source: "os_event_watcher",
      event_name: eventName,
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { cue_id: eventName.split(".")[1], label: "label", context: "context" },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain(marker);
  });

  it("proactive.tap_bored forwards its cue and drained signals", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const signals = [{ kind: "reminder", payload: { title: "Stretch" } }, { kind: "alert" }];
    const env: BusEnvelope = {
      seq_id: 12,
      source: "os_event_watcher",
      event_name: "proactive.tap_bored",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        cue_id: "tap_bored",
        label: "bored poking",
        context: "The user wants attention.",
        signals,
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("proactive");
    expect(trigger.cue).toEqual({
      label: "bored poking",
      context: "The user wants attention.",
    });
    expect(trigger.signals).toEqual(signals);
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(I keep poking at you)");
  });

  it("(c) user.text_submitted envelope (no cue_id) → trigger.cue absent", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    await caller.call(userEnv("안녕"));
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect("cue" in trigger).toBe(false);
    expect("idle_elapsed_min" in trigger).toBe(false);
  });
});

// ── agent completion triggers (agent.* payloads → trigger.kind/agent/agent_catchup) ──

describe("backend_caller — agent trigger forwarding", () => {
  /** decode the flat ClientContext from the tagged block in the user message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  it("(a) agent.done → trigger.kind 'agent' + trigger.agent; user message is proactive marker", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 30,
      source: "timer_scheduler",
      event_name: "agent.done",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        tool: "claude-code",
        project: "my-widget",
        cwd: "/home/user/my-widget",
        status: "success",
        summary: "Implemented the gizmo feature",
        ts: 1_717_000_000_000,
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect(trigger.agent).toEqual({
      tool: "claude-code",
      project: "my-widget",
      cwd: "/home/user/my-widget",
      status: "success",
      summary: "Implemented the gizmo feature",
      ts: 1_717_000_000_000,
    });
    expect("agent_catchup" in trigger).toBe(false);
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(one of my coding tasks just finished)");
  });

  it("(b) agent.done without status → trigger.agent.status absent", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 31,
      source: "timer_scheduler",
      event_name: "agent.done",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        tool: "opencode",
        project: "api",
        cwd: "/home/user/api",
        summary: "Refactored the handler",
        ts: 1_717_000_000_000,
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect("status" in (trigger.agent as Record<string, unknown>)).toBe(false);
  });

  it("(c) agent.catchup → trigger.agent_catchup with count+items; no trigger.agent", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 32,
      source: "timer_scheduler",
      event_name: "agent.catchup",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        count: 2,
        items: [
          {
            tool: "claude-code",
            project: "alpha",
            status: "success",
            summary: "Done with alpha",
            ts: 1_717_000_000_000,
          },
          {
            tool: "opencode",
            project: "beta",
            summary: "Done with beta",
            ts: 1_717_000_001_000,
          },
        ],
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect("agent" in trigger).toBe(false);
    expect(trigger.agent_catchup).toEqual({
      count: 2,
      items: [
        {
          tool: "claude-code",
          project: "alpha",
          status: "success",
          summary: "Done with alpha",
          ts: 1_717_000_000_000,
        },
        {
          tool: "opencode",
          project: "beta",
          summary: "Done with beta",
          ts: 1_717_000_001_000,
        },
      ],
    });
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(my coding tasks wrapped up while I was away)");
  });

  it("(d) agent.done with malformed payload → kind 'agent' but no trigger.agent", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 33,
      source: "timer_scheduler",
      event_name: "agent.done",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { tool: 42 }, // tool is not a string
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("agent");
    expect("agent" in trigger).toBe(false);
    expect("agent_catchup" in trigger).toBe(false);
  });
});

// ── signals ingress (signals.* payloads → trigger.kind/signals, opaque passthrough) ──
describe("backend_caller — signals trigger forwarding", () => {
  /** decode the flat ClientContext from the tagged block in the user message. */
  function clientContextOf(input: unknown): Record<string, unknown> {
    const items = input as Array<{ role: string; content: string }>;
    const user = items.find((m) => m.role === "user")!;
    return JSON.parse(clientContextJsonOf(user.content));
  }

  it("(a) signals.push → trigger.kind 'signals' + trigger.signals verbatim; user message is proactive marker", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 40,
      source: "timer_scheduler",
      event_name: "signals.push",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        signals: [{ kind: "reminder", payload: { foo: "bar" } }, { kind: "alert" }],
        ts: 1_717_000_000_000,
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const ctx = clientContextOf(request.input);
    const trigger = ctx.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("signals");
    expect(trigger.signals).toEqual([
      { kind: "reminder", payload: { foo: "bar" } },
      { kind: "alert" },
    ]);
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(a new signal just arrived for you)");
  });

  it("input is a single user item: tagged client_context block first, trigger marker last, no system item", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 44,
      source: "timer_scheduler",
      event_name: "signals.push",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { signals: [{ kind: "reminder" }], ts: 1_717_000_000_000 },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const items = request.input as Array<{ role: string; content: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.role).toBe("user");
    expect(items[0]!.content.startsWith("<client_context>\n")).toBe(true);
    expect(
      items[0]!.content.endsWith("</client_context>\n\n(a new signal just arrived for you)"),
    ).toBe(true);
    expect(items[0]!.content.split("\n")[1]).toBe(
      "Client-injected context; not typed by the user.",
    );
    expect(JSON.parse(clientContextJsonOf(items[0]!.content))).toMatchObject({
      trigger: { kind: "signals", signals: [{ kind: "reminder" }] },
    });
  });

  it("(b) signals.catchup → trigger.kind 'signals' + trigger.signals (flattened, unmodified)", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 41,
      source: "timer_scheduler",
      event_name: "signals.catchup",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {
        count: 2,
        signals: [{ id: 1 }, { id: 2 }],
      },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("signals");
    expect(trigger.signals).toEqual([{ id: 1 }, { id: 2 }]);
    const userMsg = (request.input as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!;
    expect(userMsg.content).toContain("(signals piled up while I was away)");
  });

  it("(c) heterogeneous/nested item shapes pass through unmodified — no structural validation", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const weird = [
      { a: 1 },
      { nested: { b: [1, 2, 3] } },
      { c: null },
      "not even an object" as never,
    ];
    const env: BusEnvelope = {
      seq_id: 42,
      source: "timer_scheduler",
      event_name: "signals.push",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { signals: weird, ts: 1_717_000_000_000 },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.signals).toEqual(weird);
  });

  it("(d) signals.push with missing/malformed signals field → kind 'signals' but no trigger.signals", async () => {
    script.events = [completedEvent({ speech_text: "" })];
    const env: BusEnvelope = {
      seq_id: 43,
      source: "timer_scheduler",
      event_name: "signals.push",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: { signals: "not-an-array", ts: 1_717_000_000_000 },
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const trigger = clientContextOf(request.input).trigger as Record<string, unknown>;
    expect(trigger.kind).toBe("signals");
    expect("signals" in trigger).toBe(false);
  });
});

// ── usage event → onUsage diagnostic sink ──────────────────────────────────────

describe("backend_caller — Chat Completions (CC) mode request shape", () => {
  const CC_CONFIG: EndpointsConfig = { ...CONFIG, chat_api: "chat_completions" };

  function messagesOf(request: any): Array<{ role: string; content: unknown }> {
    return request.messages;
  }

  it("builds request.messages (system client_context + transcript + user); no tools/previous_response_id/instructions", async () => {
    script.events = [completedEvent({ speech_text: "" }, "")];
    const transcriptEntries: ChatHistoryEntry[] = [
      { role: "user", text: "이전 질문", ts: 1 },
      { role: "assistant", text: "이전 답변", ts: 2 },
    ];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      transcript: { get: () => transcriptEntries, append: vi.fn() },
    });
    await caller.call(userEnv("오늘 뭐해?"));
    const [, request] = script.spy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(Array.isArray(msgs)).toBe(true);
    expect(
      msgs.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.startsWith("client_context:"),
      ),
    ).toBe(true);
    expect(msgs).toEqual(
      expect.arrayContaining([
        { role: "user", content: "이전 질문" },
        { role: "assistant", content: "이전 답변" },
      ]),
    );
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "오늘 뭐해?" });
    expect("tools" in request).toBe(false);
    expect("previous_response_id" in request).toBe(false);
    expect("instructions" in request).toBe(false);
  });

  it("no transcript dep → messages still built with empty transcript (no crash)", async () => {
    script.events = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
    });
    const res = await caller.call(userEnv("혼자"));
    expect(res.ok).toBe(true);
    const [, request] = script.spy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "혼자" });
  });

  it("agent instructions override → leading system message carries it", async () => {
    script.events = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "medium", instructions: "be terse" }),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect(request.reasoning_effort).toBe("medium");
    expect(messagesOf(request)[0]).toEqual({ role: "system", content: "be terse" });
    expect("instructions" in request).toBe(false);
  });

  it("empty agent instructions → falls back to config.chat_instructions", async () => {
    script.events = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: { ...CC_CONFIG, chat_instructions: "config nudge" },
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
      getAgentSettings: () => ({ reasoning_effort: "none", instructions: "" }),
    });
    await caller.call(userEnv());
    const [, request] = script.spy.mock.calls[0];
    expect(messagesOf(request)[0]).toEqual({ role: "system", content: "config nudge" });
  });

  it("proactive turn in CC mode → user message is the proactive background marker", async () => {
    script.events = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
    });
    const env: BusEnvelope = {
      seq_id: 50,
      source: "timer_scheduler",
      event_name: "proactive.cowork",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(msgs[msgs.length - 1]).toEqual({
      role: "user",
      content: "(I've gone quiet for a while)",
    });
  });

  it("unmapped event_name in CC mode → user message is the fallback background marker", async () => {
    script.events = [completedEvent({ speech_text: "" }, "")];
    caller = createBackendCaller({
      config: CC_CONFIG,
      renderer: { applyDirective } as never,
      getApiKey: async () => "k",
      getFetch: async () => undefined,
      stream: script.stream,
      onSpeech: speechSink,
    });
    const env: BusEnvelope = {
      seq_id: 51,
      source: "timer_scheduler",
      event_name: "unknown.something",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload: {},
    };
    await caller.call(env);
    const [, request] = script.spy.mock.calls[0];
    const msgs = messagesOf(request);
    expect(msgs[msgs.length - 1]).toEqual({
      role: "user",
      content: "(something just caught your attention)",
    });
  });
});

// ── transcript recording (both protocol modes) ──────────────────────────────
