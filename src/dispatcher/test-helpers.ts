import { type Mock, vi } from "vitest";
import type { ControlEnvelope, EndpointsConfig, ExpressArgs, ToolStatus } from "../contract";
import type {
  ChatRequest,
  ChatStreamEvent,
  StreamChatOptions,
  streamChat,
} from "../io/chat-client";
import type { Logger } from "../logger";
import type { BusEnvelope } from "./event-bus";
import type { Turn } from "./turn";
import type { TurnOutput } from "./turn-output";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ScriptedStream {
  /** Injected as BackendCallerDeps.stream. */
  stream: typeof streamChat;
  /** Records (config, request, opts) per invocation. The request is snapshotted — the caller
      mutates and reuses one object across a chain-break retry. */
  spy: Mock;
  /** Events yielded per invocation. */
  events: ChatStreamEvent[];
  /** Events for the 2nd+ invocation within one call() (chain-break retry). null = reuse `events`. */
  eventsRetry: ChatStreamEvent[] | null;
  /** One entry per invocation, shift()ed off. Takes precedence over events/eventsRetry when non-null. */
  queue: ChatStreamEvent[][] | null;
  /** Thrown after the scripted events are yielded — models a mid-flight drop. */
  error: Error | null;
  /** Per-event delay (ms) before yielding events[i]. */
  gaps: number[];
  /** Index at which the stream hangs forever (0 = before the first event). */
  hangAt: number | null;
  /** Restores every field to its default and clears the spy. */
  reset(): void;
}

/** One scripted transport fixture, injected as BackendCallerDeps.stream — union of the
    per-file mock harnesses this replaces (single script, retry script, or per-invocation queue). */
export function createScriptedStream(): ScriptedStream {
  const self = {} as ScriptedStream;
  self.spy = vi.fn();
  self.events = [];
  self.eventsRetry = null;
  self.queue = null;
  self.error = null;
  self.gaps = [];
  self.hangAt = null;
  self.stream = async function* (
    config: EndpointsConfig,
    request: ChatRequest,
    opts?: StreamChatOptions,
  ): AsyncGenerator<ChatStreamEvent> {
    self.spy(config, { ...request }, opts);
    const isRetry = self.spy.mock.calls.length > 1;
    const events =
      self.queue !== null
        ? (self.queue.shift() ?? [])
        : isRetry && self.eventsRetry !== null
          ? self.eventsRetry
          : self.events;
    for (let i = 0; i < events.length; i++) {
      if (self.hangAt === i) await sleep(2 ** 31 - 1); // never resolves in practice
      const gap = self.gaps[i] ?? 0;
      if (gap > 0) await sleep(gap);
      yield events[i]!;
    }
    if (self.hangAt === events.length) await sleep(2 ** 31 - 1);
    // yield scripted events first, then throw — models a stream that drops mid-flight.
    if (self.error) throw self.error;
  };
  self.reset = (): void => {
    self.spy.mockClear();
    self.events = [];
    self.eventsRetry = null;
    self.queue = null;
    self.error = null;
    self.gaps = [];
    self.hangAt = null;
  };
  return self;
}

export const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

/** Wraps a trigger in a Turn for BackendCaller.call — id defaults to 1 (irrelevant to most tests). */
export function turnOf(trigger: BusEnvelope, id = 1): Turn {
  return { id, trigger };
}

export function userEnv(text = "안녕"): BusEnvelope {
  return {
    seq_id: 1,
    source: "user_input_source",
    event_name: "user.text_submitted",
    ts: 1_717_000_000_000,
    payload: { text },
    hint_tier: 2,
    dnd_override: true,
  };
}

export function touchEnv(region: "chest" | "hips" = "chest"): BusEnvelope {
  return {
    seq_id: 2,
    source: "os_event_watcher",
    event_name: `proactive.touch_${region}`,
    ts: 1_717_000_000_000,
    payload: { cue_id: `touch_${region}`, label: `${region} poked` },
    hint_tier: 2,
  };
}

export function dragHeldEnv(): BusEnvelope {
  return {
    seq_id: 3,
    source: "os_event_watcher",
    event_name: "proactive.drag_held",
    ts: 1_717_000_000_000,
    payload: { cue_id: "drag_held", label: "dragged around" },
    hint_tier: 2,
  };
}

export function headPatEnv(): BusEnvelope {
  return {
    seq_id: 6,
    source: "os_event_watcher",
    event_name: "proactive.head_pat",
    ts: 1_717_000_000_000,
    payload: { cue_id: "head_pat", label: "head patted", context: "held for 2s" },
    hint_tier: 2,
  };
}

export function windowSitEnv(): BusEnvelope {
  return {
    seq_id: 4,
    source: "os_event_watcher",
    event_name: "proactive.window_sit",
    ts: 1_717_000_000_000,
    payload: { cue_id: "window_sit", label: "sat on window" },
    hint_tier: 2,
  };
}

export function peekEnv(): BusEnvelope {
  return {
    seq_id: 5,
    source: "os_event_watcher",
    event_name: "proactive.peek",
    ts: 1_717_000_000_000,
    payload: { cue_id: "peek", label: "peeking" },
    hint_tier: 2,
  };
}

export function completedEvent(env: ControlEnvelope, responseId = "resp_new"): ChatStreamEvent {
  return { type: "completed", envelope: env, responseId };
}

export function deltaEvent(text: string): ChatStreamEvent {
  return { type: "speech_delta", text };
}

export function speechDoneEvent(text: string): ChatStreamEvent {
  return { type: "speech_done", text };
}

export function keepaliveEvent(): ChatStreamEvent {
  return { type: "keepalive" };
}

export function expressEvent(args: ExpressArgs): ChatStreamEvent {
  return { type: "express", args };
}

export function usageEvent(
  input_tokens: number,
  output_tokens: number,
  total_tokens: number,
): ChatStreamEvent {
  return { type: "usage", usage: { input_tokens, output_tokens, total_tokens } };
}

export function toolStatusEvent(status: ToolStatus): ChatStreamEvent {
  return { type: "tool_status", status };
}

export function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Spy TurnOutput. `hasFiller` defaults to false (matching absent-getFiller = falsy today). */
export function makeTurnOutput(): TurnOutput & Record<keyof TurnOutput, Mock> {
  return {
    interrupt: vi.fn(),
    hasFiller: vi.fn(() => false),
    thinkingStart: vi.fn(),
    thinkingEnd: vi.fn(),
    delta: vi.fn(),
    speak: vi.fn(),
    end: vi.fn(),
    abort: vi.fn(),
    cue: vi.fn(),
    toolStatus: vi.fn(),
    activity: vi.fn(),
  };
}

/** Pull the rendered client_context lines out of the tagged block leading a user message. */
export function clientContextTextOf(userContent: string): string {
  return /<client_context>\nClient-injected context; not typed by the user\.\n([\s\S]*?)\n<\/client_context>/.exec(
    userContent,
  )![1]!;
}
