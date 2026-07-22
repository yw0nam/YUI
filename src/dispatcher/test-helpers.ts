import { vi } from "vitest";
import type { ControlEnvelope, EndpointsConfig, ExpressArgs, ToolStatus } from "../contract";
import type { ChatStreamEvent } from "../io/chat-client";
import type { Logger } from "../logger";
import type { BusEnvelope } from "./event-bus";

export const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

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
    payload: { cue_id: `touch_${region}`, label: `${region} poked`, context: "poked" },
    hint_tier: 2,
    dnd_override: true,
  };
}

export function completedEvent(env: ControlEnvelope, responseId = "resp_new"): ChatStreamEvent {
  return { type: "completed", envelope: env, responseId };
}

export function deltaEvent(text: string): ChatStreamEvent {
  return { type: "speech_delta", text };
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
