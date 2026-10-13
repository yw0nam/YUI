/**
 * wire-push.test.ts — routing an open push socket into the client.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ToolStatus, Usage } from "../../../contract";
import { PRE_SPEECH_TIMEOUT_MS } from "../../../dispatcher/backend/idle-watchdog";
import { makeTurnOutput, userEnv } from "../../../dispatcher/test-helpers";
import { createPushTurns } from "../../../dispatcher/turn/push-turn";
import { createTurnLog, type TurnLog } from "../../../dispatcher/turn/turn";
import { createTurnFeed, type TurnFeed } from "../../../dispatcher/turn/turn-feed";
import { createDelegationsStore } from "../../../io/bridge/delegations/delegations-store";
import { createReasoningStore } from "../../../io/bridge/reasoning/reasoning-store";
import type { ChatHistoryEntry } from "../../../io/chat/conversation/chat-history-store";
import type {
  DelegationItem,
  ErrorFrame,
  ReasoningFrame,
  RenderFrame,
  SpeechFrame,
  ToolCallFrame,
  ToolResultFrame,
  ToolStatusFrame,
  TurnEndFrame,
} from "../../../io/chat/push/push-frames";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import { type ClientTool, createClientToolRegistry } from "../../../io/chat/tools/client-tools";

import { wirePushMode, wirePushTransport, wireStopButton } from "./wire-push";

function fakeSocket() {
  let renderCb: ((frame: RenderFrame) => void) | null = null;
  let speechCb: ((frame: SpeechFrame) => void) | null = null;
  let turnEndCb: ((frame: TurnEndFrame) => void) | null = null;
  let delegationsCb: ((items: DelegationItem[]) => void) | null = null;
  let reasoningCb: ((frame: ReasoningFrame) => void) | null = null;
  let stateCb: ((state: PushSocketState) => void) | null = null;
  let toolStatusCb: ((frame: ToolStatusFrame) => void) | null = null;
  let toolCallCb: ((frame: ToolCallFrame) => void) | null = null;
  let errorCb: ((frame: ErrorFrame) => void) | null = null;
  let resetCb: (() => void) | null = null;
  return {
    sendVocabulary: vi.fn(),
    onRender(cb: (frame: RenderFrame) => void) {
      renderCb = cb;
      return () => {
        renderCb = null;
      };
    },
    onSpeech(cb: (frame: SpeechFrame) => void) {
      speechCb = cb;
      return () => {
        speechCb = null;
      };
    },
    onTurnEnd(cb: (frame: TurnEndFrame) => void) {
      turnEndCb = cb;
      return () => {
        turnEndCb = null;
      };
    },
    onDelegations(cb: (items: DelegationItem[]) => void) {
      delegationsCb = cb;
      return () => {
        delegationsCb = null;
      };
    },
    onReasoning(cb: (frame: ReasoningFrame) => void) {
      reasoningCb = cb;
      return () => {
        reasoningCb = null;
      };
    },
    onState(cb: (state: PushSocketState) => void) {
      stateCb = cb;
      return () => {
        stateCb = null;
      };
    },
    onToolStatus(cb: (frame: ToolStatusFrame) => void) {
      toolStatusCb = cb;
      return () => {
        toolStatusCb = null;
      };
    },
    onToolCall(cb: (frame: ToolCallFrame) => void) {
      toolCallCb = cb;
      return () => {
        toolCallCb = null;
      };
    },
    onError(cb: (frame: ErrorFrame) => void) {
      errorCb = cb;
      return () => {
        errorCb = null;
      };
    },
    onReset(cb: () => void) {
      resetCb = cb;
      return () => {
        resetCb = null;
      };
    },
    pushReset(): void {
      resetCb?.();
    },
    sendToolResult: vi.fn((_frame: ToolResultFrame) => true),
    getMaxTurnBytes: () => undefined,
    pushError(frame: ErrorFrame): void {
      errorCb?.(frame);
    },
    pushToolCall(frame: ToolCallFrame): void {
      toolCallCb?.(frame);
    },
    pushRender(frame: RenderFrame): void {
      renderCb?.(frame);
    },
    pushSpeech(frame: SpeechFrame): void {
      speechCb?.(frame);
    },
    pushTurnEnd(frame: TurnEndFrame): void {
      turnEndCb?.(frame);
    },
    pushDelegations(items: DelegationItem[]): void {
      delegationsCb?.(items);
    },
    pushReasoning(frame: ReasoningFrame): void {
      reasoningCb?.(frame);
    },
    pushState(state: PushSocketState): void {
      stateCb?.(state);
    },
    pushToolStatus(frame: ToolStatusFrame): void {
      toolStatusCb?.(frame);
    },
    hasRenderSubscriber: () => renderCb !== null,
    hasSpeechSubscriber: () => speechCb !== null,
    hasTurnEndSubscriber: () => turnEndCb !== null,
    hasDelegationsSubscriber: () => delegationsCb !== null,
    hasReasoningSubscriber: () => reasoningCb !== null,
    hasStateSubscriber: () => stateCb !== null,
    hasToolStatusSubscriber: () => toolStatusCb !== null,
    hasErrorSubscriber: () => errorCb !== null,
  };
}

function fakeMotionSettings() {
  const subs = new Set<() => void>();
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    change(): void {
      for (const cb of subs) cb();
    },
    count: () => subs.size,
  };
}

const RENDER: RenderFrame = {
  type: "render",
  turn_id: "7",
  source: "hermes",
  segments: [{ cues: [{ emotion_id: "happy" }], speech: "All green." }],
};

function fakeLog() {
  return { info: vi.fn(), warn: () => {}, error: () => {}, debug: () => {} };
}

let socket: ReturnType<typeof fakeSocket>;
let turnOutput: ReturnType<typeof makeTurnOutput>;
let pushTurns: ReturnType<typeof createPushTurns>;
let delegations: ReturnType<typeof createDelegationsStore>;
let delegationHistory: { merge: Mock<(items: DelegationItem[]) => void> };
let reasoning: ReturnType<typeof createReasoningStore>;
let records: unknown[];
let transcript: ChatHistoryEntry[];
let log: ReturnType<typeof fakeLog>;
let toolStatusSink: Mock<(status: ToolStatus) => void>;
let turnFeed: TurnFeed;
let turnLog: TurnLog;
let onUsage: Mock<(usage: Usage) => void>;

function wire(feed: TurnFeed = turnFeed, tools: readonly ClientTool[] = []) {
  return wirePushTransport({
    socket,
    tools: createClientToolRegistry(tools),
    turnOutput,
    pushTurns,
    delegations,
    delegationHistory,
    turnFeed: feed,
    appendTurnRecord: (record) => records.push(record),
    appendTranscript: (entry) => transcript.push(entry),
    reportSpokeText: (turnId, spoke) => turnLog.setSpokeText(turnId, spoke),
    onUsage,
    log,
  });
}

beforeEach(() => {
  socket = fakeSocket();
  turnOutput = makeTurnOutput();
  pushTurns = createPushTurns();
  delegations = createDelegationsStore();
  delegationHistory = { merge: vi.fn() };
  reasoning = createReasoningStore();
  records = [];
  transcript = [];
  log = fakeLog();
  toolStatusSink = vi.fn();
  turnFeed = createTurnFeed({ onToolStatus: toolStatusSink, reasoning });
  turnLog = createTurnLog();
  onUsage = vi.fn();
});

describe("wirePushTransport", () => {
  it("plays a render frame through the turn output", () => {
    wire();
    socket.pushRender(RENDER);

    expect(turnOutput.cueWithSpeech).toHaveBeenCalledWith({ emotion_id: "happy" });
    // The trailing newline is the segment boundary render-turn closes each segment with.
    expect(turnOutput.delta).toHaveBeenCalledWith("All green.\n", {
      turn_id: "7",
      event_name: "backend",
    });
    expect(records).toHaveLength(1);
  });

  it("marks the turn the render belongs to as having spoken text", () => {
    const turn = turnLog.begin(userEnv());
    pushTurns.opened(String(turn.id), turn.trigger.event_name);
    wire();
    socket.pushTurnEnd({ type: "turn_end", turn_id: String(turn.id) });
    socket.pushRender({ ...RENDER, turn_id: String(turn.id) });

    expect(turnLog.didSpeakText()).toBe(true);
    expect(turnOutput.delta).toHaveBeenCalledWith("All green.\n", {
      turn_id: String(turn.id),
      event_name: turn.trigger.event_name,
    });
  });

  it("leaves the turn's flag alone for a render whose id names no ledger turn", () => {
    const turn = turnLog.begin(userEnv());
    wire();
    socket.pushRender({ ...RENDER, turn_id: "hermes-3" });
    socket.pushRender({ ...RENDER, turn_id: ` ${turn.id}` });

    expect(turnLog.didSpeakText()).toBe(false);
  });

  it("keeps the flag when a silent frame follows a spoken one in the same turn", () => {
    const turn = turnLog.begin(userEnv());
    wire();
    socket.pushRender({ ...RENDER, turn_id: String(turn.id) });
    socket.pushRender({
      ...RENDER,
      turn_id: String(turn.id),
      segments: [{ cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }],
    });

    expect(turnLog.didSpeakText()).toBe(true);
  });

  it("puts a spoken reply in the transcript it was given", () => {
    wire();
    socket.pushRender(RENDER);

    expect(transcript).toEqual([{ role: "assistant", text: "All green.", ts: expect.any(Number) }]);
  });

  it("sends a silent frame's cues out as a speechless cue", () => {
    wire();
    socket.pushRender({
      type: "render",
      turn_id: "hermes-1",
      source: "hermes",
      segments: [{ cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }],
    });

    expect(turnOutput.silentCue).toHaveBeenCalledWith({ emotion_id: "sad" });
  });

  it("replaces the delegations list with each frame", () => {
    wire();
    socket.pushDelegations([
      { id: "d-1", title: "Sort the list", started_at: 1, state: "running" },
    ]);

    expect(delegations.get().map((d) => d.id)).toEqual(["d-1"]);
  });

  it("folds a delegations frame into the history before the live list replaces", () => {
    wire();
    const replace = vi.spyOn(delegations, "replace");
    const items: DelegationItem[] = [
      { id: "d-1", title: "Sort the list", started_at: 1, state: "running" },
    ];
    socket.pushDelegations(items);

    expect(delegationHistory.merge).toHaveBeenCalledWith(items);
    expect(delegationHistory.merge.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0],
    );
  });

  it("logs one info line per delegations frame with the total and running counts", () => {
    wire();
    socket.pushDelegations([
      { id: "d-1", title: "Sort the list", started_at: 1, state: "running" },
      { id: "d-2", title: "Done already", started_at: 1, state: "done", ended_at: 2 },
    ]);

    expect(log.info).toHaveBeenCalledExactlyOnceWith("delegations", { total: 2, running: 1 });
  });

  it("appends a reasoning delta into the reasoning store", () => {
    wire();
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "B" });

    expect(reasoning.get()).toEqual({ text: "AB", live: true });
  });

  it("closes the live reasoning cycle with the render frame's reasoning", () => {
    wire();
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    socket.pushRender({ ...RENDER, reasoning: "AB" });

    expect(reasoning.get()).toEqual({ text: "AB", live: false });
  });

  it("ends the live reasoning cycle on the turn's turn_end when no render comes", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    expect(reasoning.get()).toEqual({ text: "A", live: true });

    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("drops a reasoning delta of a turn the user stopped", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    pushTurns.cut();
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("abandons the reasoning still streaming for a turn the user stopped", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    pushTurns.cut();
    socket.pushRender({ ...RENDER, reasoning: "AB" });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("hands the usage a turn_end carries to the usage consumer once", () => {
    wire();
    const usage = { input_tokens: 1200, output_tokens: 80, total_tokens: 1280 };
    socket.pushTurnEnd({ type: "turn_end", turn_id: "7", usage });

    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(usage);
  });

  it("leaves the usage consumer alone when a turn_end carries none", () => {
    wire();
    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(onUsage).not.toHaveBeenCalled();
  });

  it("forgets the turn and logs it when its turn_end arrives", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");

    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(log.info).toHaveBeenCalledWith("push.turn_end", { turn_id: "7" });
    pushTurns.cut();
    expect(pushTurns.isCut("7")).toBe(false);
  });

  it("keeps a reasoning text an earlier render finished when a later frame is dropped", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    socket.pushRender({ ...RENDER, reasoning: "AB" });
    pushTurns.opened("8", "user.text_submitted");
    pushTurns.cut();
    socket.pushRender({ ...RENDER, turn_id: "8", reasoning: "CD" });

    expect(reasoning.get()).toEqual({ text: "AB", live: false });
  });

  it("interrupts the reasoning on a non-ready socket state", () => {
    wire();
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    socket.pushState({ kind: "reconnecting", delay_ms: 1_000 });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("hands every tool_status frame to the tool-status sink and the turn's waiter", () => {
    wire();
    const waiter = vi.fn();
    pushTurns.opened("7", "user.text_submitted");
    void pushTurns.awaitTurnEnd("7", { onToolStatus: waiter });
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });

    expect(toolStatusSink).toHaveBeenCalledWith({ state: "running", tool_id: "read_file" });
    expect(waiter).toHaveBeenCalledWith("running", "read_file");
  });

  it("calls the tool-status sink for a frame of a turn with no waiter", () => {
    wire();
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "hermes-1",
      state: "done",
      tool_id: "read_file",
    });

    expect(toolStatusSink).toHaveBeenCalledWith({ state: "done", tool_id: "read_file" });
  });

  it("flows one idle to the chip when a turn ends with its tool still running", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });
    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "idle" });
  });

  it("a turn_end for another turn leaves the running tool's chip alone", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });
    socket.pushTurnEnd({ type: "turn_end", turn_id: "hermes-1" });

    expect(toolStatusSink).not.toHaveBeenCalledWith({ state: "idle" });

    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(toolStatusSink).toHaveBeenCalledWith({ state: "idle" });
  });

  it("never flows idle behind a done frame, so the chip's done hold is not cut short", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "done",
      tool_id: "read_file",
    });
    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(toolStatusSink.mock.calls).toEqual([
      [{ state: "running", tool_id: "read_file" }],
      [{ state: "done", tool_id: "read_file" }],
    ]);
  });

  it("flows one idle to the chip when the socket leaves ready with a tool still running", () => {
    wire();
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });
    socket.pushState({ kind: "reconnecting", delay_ms: 1_000 });

    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "idle" });
  });

  it("never lights the chip for a frame of a turn the user stopped", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    pushTurns.cut();
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });

    expect(toolStatusSink).not.toHaveBeenCalled();
  });

  it("drops every subscription on dispose", () => {
    const dispose = wire();
    dispose();

    expect(socket.hasRenderSubscriber()).toBe(false);
    expect(socket.hasSpeechSubscriber()).toBe(false);
    expect(socket.hasTurnEndSubscriber()).toBe(false);
    expect(socket.hasDelegationsSubscriber()).toBe(false);
    expect(socket.hasReasoningSubscriber()).toBe(false);
    expect(socket.hasStateSubscriber()).toBe(false);
    expect(socket.hasToolStatusSubscriber()).toBe(false);
    expect(socket.hasErrorSubscriber()).toBe(false);
  });
});

describe("wirePushTransport — error frames", () => {
  it("hands the frame's message to the turn's waiter, which still ends on the turn_end", async () => {
    wire();
    const onError = vi.fn();
    pushTurns.opened("7", "user.text_submitted");
    const ended = pushTurns.awaitTurnEnd("7", { onError });

    socket.pushError({ type: "error", turn_id: "7", message: "rate limit reached" });
    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(onError).toHaveBeenCalledWith("rate limit reached");
    await expect(ended).resolves.toBe("ended");
    expect(log.info).toHaveBeenCalledWith("push.error", {
      turn_id: "7",
      message: "rate limit reached",
    });
  });

  it("leaves another turn's waiter alone", () => {
    wire();
    const onError = vi.fn();
    pushTurns.opened("7", "user.text_submitted");
    void pushTurns.awaitTurnEnd("7", { onError });

    socket.pushError({ type: "error", turn_id: "hermes-1", message: "boom" });

    expect(onError).not.toHaveBeenCalled();
  });

  it("drops the frame of a turn the user stopped", () => {
    wire();
    const onError = vi.fn();
    pushTurns.opened("7", "user.text_submitted");
    void pushTurns.awaitTurnEnd("7", { onError });
    pushTurns.cut();

    socket.pushError({ type: "error", turn_id: "7", message: "boom" });

    expect(onError).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalledWith("push.error", expect.anything());
  });
});

describe("wirePushTransport — tool calls", () => {
  const look: ClientTool = {
    name: "look",
    definition: {
      type: "function",
      function: {
        name: "look",
        description: "dummy",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    execute: async () => '{"moving":false}',
    waitMs: 2000,
  };
  const frame = (id: string, turnId: string): ToolCallFrame => ({
    type: "tool_call",
    id,
    turn_id: turnId,
    name: "look",
    arguments: { at: "body" },
  });

  it("runs a tool_call from the socket and sends its tool_result", async () => {
    wire(turnFeed, [look]);
    socket.pushToolCall(frame("c1", "7"));

    await vi.waitFor(() =>
      expect(socket.sendToolResult).toHaveBeenCalledWith({
        type: "tool_result",
        id: "c1",
        turn_id: "7",
        result: '{"moving":false}',
      }),
    );
  });

  it.each<[string, (dispose: () => void) => void]>([
    ["a cut of its turn", () => void pushTurns.cut()],
    ["the socket leaving ready", () => socket.pushState({ kind: "reconnecting", delay_ms: 1_000 })],
    ["a session reset", () => socket.pushReset()],
    ["disposal", (dispose) => dispose()],
  ])("aborts a running call's signal on %s", async (_name, act) => {
    let signal: AbortSignal | undefined;
    const slow: ClientTool = {
      ...look,
      execute: (_args, s) => {
        signal = s;
        return new Promise((resolve) =>
          s?.addEventListener("abort", () => resolve("cancelled: nothing ran")),
        );
      },
    };
    pushTurns.opened("7", "user.text_submitted");
    const dispose = wire(turnFeed, [slow]);
    socket.pushToolCall(frame("c1", "7"));
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    act(dispose);

    expect(signal?.aborted).toBe(true);
  });

  it("shows a client-run tool's status from its own run, ignoring the backend's for it", async () => {
    let finish: ((result: string) => void) | undefined;
    const browser: ClientTool = {
      ...look,
      name: "browser",
      localStatus: true,
      statusAction: (args) => String(args.action),
      execute: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
    pushTurns.opened("7", "user.text_submitted");
    const waiter = vi.fn();
    void pushTurns.awaitTurnEnd("7", { onToolStatus: waiter });
    wire(turnFeed, [browser]);
    socket.pushToolCall({ ...frame("c1", "7"), name: "browser", arguments: { action: "read" } });
    await vi.waitFor(() => expect(finish).toBeDefined());
    socket.pushToolStatus({ type: "tool_status", turn_id: "7", state: "done", tool_id: "browser" });

    expect(toolStatusSink.mock.calls).toEqual([
      [{ state: "running", tool_id: "browser", action: "read" }],
    ]);
    expect(waiter).not.toHaveBeenCalled();

    finish?.("Untrusted page content from the browser.\n{}");
    await vi.waitFor(() =>
      expect(toolStatusSink).toHaveBeenLastCalledWith({
        state: "done",
        tool_id: "browser",
        action: "read",
      }),
    );
  });

  it("a client-run call's terminal state leaves a newer running chip alone", async () => {
    let finish: ((result: string) => void) | undefined;
    const browser: ClientTool = {
      ...look,
      name: "browser",
      localStatus: true,
      execute: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
    wire(turnFeed, [browser]);
    socket.pushToolCall({ ...frame("c1", "7"), name: "browser", arguments: { action: "read" } });
    await vi.waitFor(() => expect(finish).toBeDefined());
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });
    finish?.("cancelled: nothing ran");
    await vi.waitFor(() => expect(socket.sendToolResult).toHaveBeenCalled());

    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "running", tool_id: "read_file" });
  });

  it("refuses a tool_call of a turn the user cut", () => {
    wire(turnFeed, [look]);
    pushTurns.opened("9", "user.text_submitted");
    pushTurns.cut();
    socket.pushToolCall(frame("c2", "9"));

    expect(socket.sendToolResult).toHaveBeenCalledWith({
      type: "tool_result",
      id: "c2",
      turn_id: "9",
      result: "error: turn stopped",
    });
  });
});

describe("wirePushTransport — speech frames", () => {
  const SPEECH: SpeechFrame = {
    type: "speech",
    turn_id: "7",
    segments: [{ speech: "All green." }],
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays speech frames into one utterance the turn's render closes", () => {
    wire();
    socket.pushSpeech(SPEECH);
    socket.pushSpeech({ ...SPEECH, segments: [{ speech: "Every one." }] });

    expect(turnOutput.delta).toHaveBeenCalledWith("All green.\n", {
      turn_id: "7",
      event_name: "backend",
    });
    expect(turnOutput.delta).toHaveBeenCalledWith("Every one.\n", {
      turn_id: "7",
      event_name: "backend",
    });
    expect(turnOutput.end).not.toHaveBeenCalled();

    socket.pushRender({ ...RENDER, segments: [] });

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toEqual([
      { role: "assistant", text: "All green. Every one.", ts: expect.any(Number) },
    ]);
  });

  it.each([
    ["the client's", "7"],
    ["a backend-minted", "hermes-1"],
  ])("ends %s turn's open utterance on its turn_end, before the turn is forgotten", (_label, turnId) => {
    const ended = vi.spyOn(pushTurns, "ended");
    wire();
    socket.pushSpeech({ ...SPEECH, turn_id: turnId });
    socket.pushTurnEnd({ type: "turn_end", turn_id: turnId });

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(turnOutput.end.mock.invocationCallOrder[0]).toBeLessThan(
      ended.mock.invocationCallOrder[0]!,
    );
    expect(transcript).toEqual([{ role: "assistant", text: "All green.", ts: expect.any(Number) }]);
  });

  it("leaves the open utterance alone on another turn's turn_end", () => {
    wire();
    socket.pushSpeech(SPEECH);
    socket.pushTurnEnd({ type: "turn_end", turn_id: "8" });

    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it.each([
    ["the client's", "7"],
    ["a backend-minted", "hermes-1"],
  ])("ends %s turn's open utterance when the socket leaves ready", (_label, turnId) => {
    wire();
    socket.pushSpeech({ ...SPEECH, turn_id: turnId });
    socket.pushState({ kind: "reconnecting", delay_ms: 1_000 });

    expect(turnOutput.end).toHaveBeenCalledOnce();
    expect(transcript).toHaveLength(1);
  });

  it("keeps the open utterance on a ready socket state", () => {
    wire();
    socket.pushSpeech(SPEECH);
    socket.pushState({ kind: "ready", chat_id: "yui-1" });

    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("ends the open utterance once the frame wait passes with no frame of its turn", () => {
    vi.useFakeTimers();
    wire();
    socket.pushSpeech({ ...SPEECH, turn_id: "hermes-1" });
    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS);

    expect(turnOutput.end).toHaveBeenCalledOnce();
  });

  it("drops a cut turn's open utterance: one transcript entry before the user's next, no end()", () => {
    wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushSpeech(SPEECH);
    pushTurns.cut();
    // The user's own half of the turn that cut the reply.
    transcript.push({ role: "user", text: "Stop there.", ts: 1 });
    socket.pushRender({ ...RENDER, segments: [{ speech: "Want the list?" }] });

    expect(transcript).toEqual([
      { role: "assistant", text: "All green.", ts: expect.any(Number) },
      { role: "user", text: "Stop there.", ts: 1 },
    ]);
    expect(turnOutput.end).not.toHaveBeenCalled();
  });

  it("brings the thinking bridge down on the first speech frame, once", () => {
    wire();
    const onFirstRender = vi.fn();
    pushTurns.opened("7", "user.text_submitted");
    void pushTurns.awaitTurnEnd("7", { onFirstRender });
    socket.pushSpeech(SPEECH);

    expect(onFirstRender).toHaveBeenCalledOnce();

    socket.pushSpeech(SPEECH);
    socket.pushRender(RENDER);

    expect(onFirstRender).toHaveBeenCalledOnce();
  });

  it("leaves the reasoning as it is on a speech frame", () => {
    wire();
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    socket.pushSpeech(SPEECH);

    expect(reasoning.get()).toEqual({ text: "A", live: true });
  });

  it("stops hearing cuts and the frame wait once disposed", () => {
    vi.useFakeTimers();
    const dispose = wire();
    pushTurns.opened("7", "user.text_submitted");
    socket.pushSpeech(SPEECH);
    dispose();
    pushTurns.cut();
    vi.advanceTimersByTime(PRE_SPEECH_TIMEOUT_MS);

    expect(transcript).toEqual([]);
    expect(turnOutput.end).not.toHaveBeenCalled();
  });
});

describe("wirePushTransport — teardown through the shared turn feed", () => {
  function lightToolAndCycle(feed: TurnFeed, cycle: "push" | "stream"): void {
    pushTurns.opened("7", "user.text_submitted");
    socket.pushToolStatus({
      type: "tool_status",
      turn_id: "7",
      state: "running",
      tool_id: "read_file",
    });
    if (cycle === "push") socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    else feed.reasoning("stream:12", "S");
  }

  it.each([
    ["a push-owned cycle", "push", { text: "", live: false }],
    ["a stream-owned cycle", "stream", { text: "S", live: true }],
  ] as const)("the socket leaving ready idles the push tool and ends %s", (_label, cycle, expected) => {
    const feed = createTurnFeed({ onToolStatus: toolStatusSink, reasoning });
    wire(feed);
    lightToolAndCycle(feed, cycle);

    socket.pushState({ kind: "reconnecting", delay_ms: 1_000 });

    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "idle" });
    expect(reasoning.get()).toEqual(expected);
  });

  it.each([
    ["a push-owned cycle", "push", { text: "", live: false }],
    ["a stream-owned cycle", "stream", { text: "S", live: true }],
  ] as const)("dispose idles the push tool and ends %s", (_label, cycle, expected) => {
    const feed = createTurnFeed({ onToolStatus: toolStatusSink, reasoning });
    const dispose = wire(feed);
    lightToolAndCycle(feed, cycle);

    dispose();

    expect(toolStatusSink).toHaveBeenLastCalledWith({ state: "idle" });
    expect(reasoning.get()).toEqual(expected);
  });
});

describe("wireStopButton", () => {
  let sendStop: Mock<(turnIds: string[]) => boolean>;
  let onStopCb: (() => void) | null = null;

  function wireStop(withSocket = true): void {
    sendStop = vi.fn(() => true);
    onStopCb = null;
    wireStopButton({
      onStop(cb) {
        onStopCb = cb;
      },
      stopTurn: () => pushTurns.cut(),
      socket: withSocket ? { sendStop } : undefined,
      log,
    });
  }

  it("sends one stop naming exactly the turns outstanding", () => {
    pushTurns.opened("A", "user.text_submitted");
    pushTurns.opened("B", "user.text_submitted");
    wireStop();
    onStopCb?.();

    expect(sendStop).toHaveBeenCalledExactlyOnceWith(["A", "B"]);
    expect(log.info).toHaveBeenCalledExactlyOnceWith("push.stop", { count: 2 });
  });

  it("does not name a turn opened after the stop", () => {
    wireStop();
    pushTurns.opened("A", "user.text_submitted");
    onStopCb?.();
    pushTurns.opened("B", "user.text_submitted");
    onStopCb?.();

    expect(sendStop.mock.calls).toEqual([[["A"]], [["B"]]]);
  });

  it("sends nothing with no turn outstanding", () => {
    wireStop();
    onStopCb?.();

    expect(sendStop).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("without a socket still stops the turn and sends nothing", () => {
    wireStop(false);
    pushTurns.opened("A", "user.text_submitted");
    onStopCb?.();

    expect(pushTurns.isCut("A")).toBe(true);
    expect(log.info).not.toHaveBeenCalled();
  });
});

describe("wirePushMode", () => {
  let connect: Mock<() => void>;
  let disconnect: Mock<() => void>;
  let chipCreate: Mock<() => void>;
  let chipDispose: Mock<() => void>;
  let endpoints: { chat_api?: string; chat_base_url: string };
  let endpointsSettings: ReturnType<typeof fakeMotionSettings>;
  let chatKeySettings: ReturnType<typeof fakeMotionSettings>;

  /** A suspension port a test can flip, like the page going under and coming back. */
  function hiddenPort(initial: boolean) {
    let hidden = initial;
    const subs = new Set<() => void>();
    return {
      get: () => hidden,
      subscribe: (cb: () => void) => {
        subs.add(cb);
        return () => {
          subs.delete(cb);
        };
      },
      hide() {
        hidden = true;
        for (const cb of [...subs]) cb();
      },
      show() {
        hidden = false;
        for (const cb of [...subs]) cb();
      },
    };
  }

  function wireMode(suspended?: { get(): boolean; subscribe(cb: () => void): () => void }) {
    return wirePushMode({
      socket: { connect, disconnect },
      chip: { create: chipCreate, dispose: chipDispose },
      getEndpoints: () => endpoints as never,
      endpointsSettings,
      chatKeySettings,
      ...(suspended ? { suspended } : {}),
    });
  }

  beforeEach(() => {
    connect = vi.fn<() => void>();
    disconnect = vi.fn<() => void>();
    chipCreate = vi.fn<() => void>();
    chipDispose = vi.fn<() => void>();
    endpoints = { chat_api: "push", chat_base_url: "http://localhost:8646" };
    endpointsSettings = fakeMotionSettings();
    chatKeySettings = fakeMotionSettings();
  });

  it("connects straight away when the mode is push and an endpoint is set", () => {
    wireMode();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("stays down in the other protocol modes", () => {
    endpoints.chat_api = "responses";
    wireMode();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("stays down while the chat endpoint is empty", () => {
    endpoints.chat_base_url = "   ";
    wireMode();

    expect(connect).not.toHaveBeenCalled();
  });

  it("connects when the user switches into push mode", () => {
    endpoints.chat_api = "chat_completions";
    wireMode();

    endpoints.chat_api = "push";
    endpointsSettings.change();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("connects when the user fills in the endpoint afterwards", () => {
    endpoints.chat_base_url = "";
    wireMode();

    endpoints.chat_base_url = "http://localhost:8646";
    endpointsSettings.change();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects when the user leaves push mode", () => {
    wireMode();

    endpoints.chat_api = "responses";
    endpointsSettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("reopens on the new endpoint when the URL is edited", () => {
    wireMode();

    endpoints.chat_base_url = "https://agent.example:9000";
    endpointsSettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("reopens so the next attempt carries the edited key", () => {
    wireMode();
    chatKeySettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("leaves the open socket alone when nothing about the connection changed", () => {
    wireMode();
    endpointsSettings.change();

    expect(disconnect).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("ignores a key edit while the mode is not push", () => {
    endpoints.chat_api = "responses";
    wireMode();
    chatKeySettings.change();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("does not disconnect twice when the mode is left and left again", () => {
    wireMode();
    endpoints.chat_api = "responses";
    endpointsSettings.change();
    endpointsSettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates the chip straight away when starting in push mode", () => {
    wireMode();
    expect(chipCreate).toHaveBeenCalledTimes(1);
  });

  it("never creates the chip in the other protocol modes", () => {
    endpoints.chat_api = "responses";
    wireMode();

    expect(chipCreate).not.toHaveBeenCalled();
  });

  it("creates the chip even while the endpoint is unset", () => {
    endpoints.chat_base_url = "";
    wireMode();

    expect(chipCreate).toHaveBeenCalledTimes(1);
  });

  it("creates the chip when the user switches into push mode", () => {
    endpoints.chat_api = "chat_completions";
    wireMode();

    endpoints.chat_api = "push";
    endpointsSettings.change();

    expect(chipCreate).toHaveBeenCalledTimes(1);
    expect(chipDispose).not.toHaveBeenCalled();
  });

  it("disposes the chip when the user leaves push mode", () => {
    wireMode();

    endpoints.chat_api = "responses";
    endpointsSettings.change();

    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("does not recreate the chip on an endpoint or key edit while staying in push mode", () => {
    wireMode();

    endpoints.chat_base_url = "https://agent.example:9000";
    endpointsSettings.change();
    chatKeySettings.change();

    expect(chipCreate).toHaveBeenCalledTimes(1);
    expect(chipDispose).not.toHaveBeenCalled();
  });

  it("disposes the chip on teardown while the mode is still push", () => {
    const dispose = wireMode();
    dispose();

    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("does not dispose the chip again on teardown once the mode already left push", () => {
    const dispose = wireMode();
    endpoints.chat_api = "responses";
    endpointsSettings.change();
    dispose();

    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("drops both subscriptions on dispose", () => {
    wireMode()();

    expect(endpointsSettings.count()).toBe(0);
    expect(chatKeySettings.count()).toBe(0);
  });

  it("keeps the chip mounted while the page is hidden", () => {
    const dispose = wireMode(hiddenPort(true));

    expect(chipCreate).toHaveBeenCalledTimes(1);
    expect(chipDispose).not.toHaveBeenCalled();

    dispose();
    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("disconnects on hide and reconnects on show", () => {
    const port = hiddenPort(false);
    wireMode(port);

    port.hide();
    expect(disconnect).toHaveBeenCalledTimes(1);

    port.show();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("ignores an endpoint or key edit while hidden, then opens on the current target on show", () => {
    const port = hiddenPort(true);
    wireMode(port);

    endpoints.chat_base_url = "https://agent.example:9000";
    endpointsSettings.change();
    chatKeySettings.change();
    expect(connect).not.toHaveBeenCalled();

    port.show();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
