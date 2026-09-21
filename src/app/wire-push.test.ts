/**
 * wire-push.test.ts — routing an open push socket into the client.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ToolStatus } from "../contract";
import { PRE_SPEECH_TIMEOUT_MS } from "../dispatcher/backend/idle-watchdog";
import { makeTurnOutput } from "../dispatcher/test-helpers";
import { createPushTurns } from "../dispatcher/turn/push-turn";
import { createTurnFeed, type TurnFeed } from "../dispatcher/turn/turn-feed";
import { createDelegationsStore } from "../io/bridge/delegations-store";
import { createReasoningStore } from "../io/bridge/reasoning-store";
import type { ChatHistoryEntry } from "../io/chat/chat-history-store";
import type {
  DelegationItem,
  PushSocketState,
  ReasoningFrame,
  RenderFrame,
  SpeechFrame,
  ToolStatusFrame,
  TurnEndFrame,
} from "../io/chat/push-socket";
import { wirePushMode, wirePushTransport, wireStopButton } from "./wire-push";

function fakeSocket() {
  let renderCb: ((frame: RenderFrame) => void) | null = null;
  let speechCb: ((frame: SpeechFrame) => void) | null = null;
  let turnEndCb: ((frame: TurnEndFrame) => void) | null = null;
  let delegationsCb: ((items: DelegationItem[]) => void) | null = null;
  let reasoningCb: ((frame: ReasoningFrame) => void) | null = null;
  let stateCb: ((state: PushSocketState) => void) | null = null;
  let toolStatusCb: ((frame: ToolStatusFrame) => void) | null = null;
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

function wire(feed: TurnFeed = turnFeed) {
  return wirePushTransport({
    socket,
    turnOutput,
    pushTurns,
    delegations,
    delegationHistory,
    turnFeed: feed,
    appendTurnRecord: (record) => records.push(record),
    appendTranscript: (entry) => transcript.push(entry),
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
});

describe("wirePushTransport", () => {
  it("plays a render frame through the turn output", () => {
    wire();
    socket.pushRender(RENDER);

    expect(turnOutput.cueWithSpeech).toHaveBeenCalledWith({ emotion_id: "happy" });
    // The trailing newline is the segment boundary render-turn closes each segment with.
    expect(turnOutput.delta).toHaveBeenCalledWith("All green.\n");
    expect(records).toHaveLength(1);
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
    pushTurns.opened("7");
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    expect(reasoning.get()).toEqual({ text: "A", live: true });

    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("drops a reasoning delta of a turn the user stopped", () => {
    wire();
    pushTurns.opened("7");
    pushTurns.cut();
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("abandons the reasoning still streaming for a turn the user stopped", () => {
    wire();
    pushTurns.opened("7");
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    pushTurns.cut();
    socket.pushRender({ ...RENDER, reasoning: "AB" });

    expect(reasoning.get()).toEqual({ text: "", live: false });
  });

  it("forgets the turn and logs it when its turn_end arrives", () => {
    wire();
    pushTurns.opened("7");

    socket.pushTurnEnd({ type: "turn_end", turn_id: "7" });

    expect(log.info).toHaveBeenCalledWith("push.turn_end", { turn_id: "7" });
    pushTurns.cut();
    expect(pushTurns.isCut("7")).toBe(false);
  });

  it("keeps a reasoning text an earlier render finished when a later frame is dropped", () => {
    wire();
    pushTurns.opened("7");
    socket.pushReasoning({ type: "reasoning", turn_id: "7", delta: "A" });
    socket.pushRender({ ...RENDER, reasoning: "AB" });
    pushTurns.opened("8");
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

  it("hands every tool_status frame to the tool chip sink and the turn's waiter", () => {
    wire();
    const waiter = vi.fn();
    pushTurns.opened("7");
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

  it("calls the tool chip sink for a frame of a turn with no waiter", () => {
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
    pushTurns.opened("7");
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
    pushTurns.opened("7");
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
    pushTurns.opened("7");
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
    pushTurns.opened("7");
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

    expect(turnOutput.delta).toHaveBeenCalledWith("All green.\n");
    expect(turnOutput.delta).toHaveBeenCalledWith("Every one.\n");
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
    pushTurns.opened("7");
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
    pushTurns.opened("7");
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
    pushTurns.opened("7");
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
    pushTurns.opened("7");
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
    pushTurns.opened("A");
    pushTurns.opened("B");
    wireStop();
    onStopCb?.();

    expect(sendStop).toHaveBeenCalledExactlyOnceWith(["A", "B"]);
    expect(log.info).toHaveBeenCalledExactlyOnceWith("push.stop", { count: 2 });
  });

  it("does not name a turn opened after the stop", () => {
    wireStop();
    pushTurns.opened("A");
    onStopCb?.();
    pushTurns.opened("B");
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
    pushTurns.opened("A");
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

  function wireMode() {
    return wirePushMode({
      socket: { connect, disconnect },
      chip: { create: chipCreate, dispose: chipDispose },
      getEndpoints: () => endpoints as never,
      endpointsSettings,
      chatKeySettings,
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
});
