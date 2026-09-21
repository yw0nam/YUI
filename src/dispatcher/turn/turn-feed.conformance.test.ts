/**
 * turn-feed.conformance.test.ts — one logical reply, routed through either transport, reaches
 * the same tool sink and drives the same reasoning-store states. Owners are transport
 * correlation and are not compared.
 */

import { describe, expect, it, vi } from "vitest";
import { wirePushTransport } from "../../app/turn/wire-push";
import type { ToolStatus } from "../../contract";
import { createDelegationsStore } from "../../io/bridge/delegations-store";
import { createReasoningStore, type ReasoningState } from "../../io/bridge/reasoning-store";
import type { ReasoningFrame, RenderFrame, ToolStatusFrame } from "../../io/chat/push-socket";
import { createBackendCaller } from "../backend/backend-caller";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  makeLogger,
  makeTurnOutput,
  reasoningEvent,
  toolStatusEvent,
  turnOf,
  userEnv,
} from "../test-helpers";
import { createPushTurns } from "./push-turn";
import { createTurnFeed } from "./turn-feed";

const RUNNING: ToolStatus = { state: "running", tool_id: "web_search" };
const DONE: ToolStatus = { state: "done", tool_id: "web_search" };

interface Run {
  tool: ToolStatus[];
  states: ReasoningState[];
}

async function runStream(): Promise<Run> {
  const tool: ToolStatus[] = [];
  const states: ReasoningState[] = [];
  const store = createReasoningStore();
  store.subscribe((s) => states.push(s));
  const script = createScriptedStream();
  script.events = [
    toolStatusEvent(RUNNING),
    reasoningEvent("weighing"),
    toolStatusEvent(DONE),
    reasoningEvent(" the odds"),
    completedEvent({ speech_text: "So." }),
  ];
  const caller = createBackendCaller({
    config: CONFIG,
    renderer: { applyDirective: vi.fn() } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    stream: script.stream,
    turnOutput: makeTurnOutput(),
    turnFeed: createTurnFeed({ onToolStatus: (s) => tool.push(s), reasoning: store }),
    logger: makeLogger(),
  });
  await caller.call(turnOf(userEnv()));
  return { tool, states };
}

function runPush(): Run {
  const tool: ToolStatus[] = [];
  const states: ReasoningState[] = [];
  const store = createReasoningStore();
  store.subscribe((s) => states.push(s));
  let onRender: ((frame: RenderFrame) => void) | null = null;
  let onReasoning: ((frame: ReasoningFrame) => void) | null = null;
  let onToolStatus: ((frame: ToolStatusFrame) => void) | null = null;
  wirePushTransport({
    socket: {
      onRender(cb) {
        onRender = cb;
        return () => {};
      },
      onSpeech: () => () => {},
      onTurnEnd: () => () => {},
      onToolStatus(cb) {
        onToolStatus = cb;
        return () => {};
      },
      onDelegations: () => () => {},
      onReasoning(cb) {
        onReasoning = cb;
        return () => {};
      },
      onState: () => () => {},
    },
    turnOutput: makeTurnOutput(),
    pushTurns: createPushTurns(),
    delegations: createDelegationsStore(),
    delegationHistory: { merge: () => {} },
    turnFeed: createTurnFeed({ onToolStatus: (s) => tool.push(s), reasoning: store }),
    appendTurnRecord: () => {},
    appendTranscript: () => {},
    log: makeLogger(),
  });
  onToolStatus!({
    type: "tool_status",
    turn_id: "hermes-1",
    state: "running",
    tool_id: "web_search",
  });
  onReasoning!({ type: "reasoning", turn_id: "hermes-1", delta: "weighing" });
  onToolStatus!({ type: "tool_status", turn_id: "hermes-1", state: "done", tool_id: "web_search" });
  onReasoning!({ type: "reasoning", turn_id: "hermes-1", delta: " the odds" });
  onRender!({
    type: "render",
    turn_id: "hermes-1",
    source: "hermes",
    segments: [{ speech: "So." }],
  });
  return { tool, states };
}

describe("turn-feed conformance", () => {
  it("the same logical reply reaches the same sinks through either transport", async () => {
    const stream = await runStream();
    const push = runPush();

    expect(stream.tool).toEqual([RUNNING, DONE]);
    expect(stream.states.at(-1)).toEqual({ text: "weighing the odds", live: false });
    expect(push.tool).toEqual(stream.tool);
    expect(push.states).toEqual(stream.states);
  });
});
