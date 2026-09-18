/**
 * backend-caller.push.test.ts — the push transport (chat_api: "push").
 *
 * The turn goes out as one frame on the WebSocket and the call stays open until that turn's
 * `turn_end`, so the app shows the turn running for as long as the backend works on it. The frame
 * wait restarts on every frame of the turn; a socket that is not ready ends the turn as a network
 * failure before it is sent.
 *
 * Nothing the backend pushes stops speech here; a turn the user typed or spoke does, and stops the
 * push turns still outstanding with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../contract";
import type { ChatHistoryEntry } from "../../io/chat/chat-history-store";
import type { PushTurnFrame } from "../../io/chat/push-socket";
import type { Logger } from "../../logger";
import type { BusEnvelope } from "../core/event-bus";
import { CONFIG, makeLogger, makeTurnOutput, touchEnv, turnOf, userEnv } from "../test-helpers";
import { createPushTurns } from "../turn/push-turn";
import { createRenderTurn } from "../turn/render-turn";
import { createBackendCaller, type TurnOutcome } from "./backend-caller";
import { PRE_SPEECH_TIMEOUT_MS } from "./idle-watchdog";

function scheduleEnv(): BusEnvelope {
  return {
    seq_id: 3,
    source: "timer_scheduler",
    event_name: "schedule.morning",
    ts: 1_717_000_000_000,
    payload: { cue_id: "morning", label: "morning check-in" },
    hint_tier: 2,
  };
}

const PUSH_CONFIG: EndpointsConfig = { ...CONFIG, chat_api: "push" };

let turnOutput: ReturnType<typeof makeTurnOutput>;
let logger: Logger;
let sent: PushTurnFrame[];
let records: unknown[];
let contexts: unknown[];
let spoke: boolean[];
let transcript: ChatHistoryEntry[];
let sessionToken: string;
/** Runs when the turn frame goes out — the window a mid-turn reset lands in. */
let onTurnSent: (() => void) | null;
/** Runs while the context is being built — the window a newer turn lands in. */
let onContextBuilt: (() => void) | null;
/** Speech and push-turn stops, in the order the call made them. */
let order: string[];
let cuts: number;
let sentIds: string[];
let pushTurns: ReturnType<typeof createPushTurns>;
/** Turn ids the call told the store to stop waiting on. */
let abandoned: string[];
/** Whether an accepted frame answers itself with a render — off for the tests that drive the wait. */
let autoRender: boolean;
let socket: ReturnType<typeof fakeSocketState>;

/** The socket-not-ready subscription, counting the subscribers still registered. */
function fakeSocketState() {
  const subs = new Set<() => void>();
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    leaveReady(): void {
      for (const cb of [...subs]) cb();
    },
    subscriberCount: () => subs.size,
  };
}

function callerWith(accepted: boolean, config: EndpointsConfig = PUSH_CONFIG) {
  sent = [];
  records = [];
  contexts = [];
  spoke = [];
  transcript = [];
  sessionToken = "s-1";
  onTurnSent = null;
  onContextBuilt = null;
  order = [];
  cuts = 0;
  sentIds = [];
  pushTurns = createPushTurns();
  abandoned = [];
  socket = fakeSocketState();
  turnOutput.interrupt.mockImplementation(() => {
    order.push("interrupt");
  });
  return createBackendCaller({
    transcript: {
      entriesAfterLastBoundary: () => [],
      append: (entry) => transcript.push(entry),
      sessionToken: () => sessionToken,
    },
    config,
    renderer: { applyDirective: vi.fn() } as never,
    getApiKey: async () => "k",
    getFetch: async () => {
      throw new Error("push mode must not resolve a fetch");
    },
    stream: () => {
      throw new Error("push mode must not open a chat stream");
    },
    turnOutput,
    getPrevious: () => {
      order.push("context");
      onContextBuilt?.();
      return undefined;
    },
    pushTurn: (frame) => {
      sent.push(frame);
      onTurnSent?.();
      // The backend's answer lands after the call registered its waiter, as the real socket's does:
      // the render, then the turn_end that closes the turn.
      if (accepted && autoRender) {
        queueMicrotask(() => {
          pushTurns.rendered(frame.turn_id);
          pushTurns.ended(frame.turn_id);
        });
      }
      return accepted;
    },
    onPushTurnCut: () => {
      order.push("cut");
      cuts++;
      pushTurns.cut();
    },
    onPushTurnSent: (turnId) => {
      sentIds.push(turnId);
      pushTurns.opened(turnId);
    },
    pushTurns: {
      awaitTurnEnd: (turnId, hooks) => pushTurns.awaitTurnEnd(turnId, hooks),
      abandon: (turnId) => {
        abandoned.push(turnId);
        pushTurns.abandon(turnId);
      },
    },
    onPushSocketNotReady: (cb) => socket.subscribe(cb),
    reportSpokeText: (v) => spoke.push(v),
    contextHistory: { append: (entry) => contexts.push(entry) },
    appendTurnRecord: (record) => records.push(record),
    logger,
  });
}

beforeEach(() => {
  turnOutput = makeTurnOutput();
  logger = makeLogger();
  autoRender = true;
});

describe("backend_caller — push transport", () => {
  it("sends one turn frame carrying the client_context block and the utterance", async () => {
    const outcome = await callerWith(true).call(turnOf(userEnv("안녕"), 7));

    expect(outcome).toBe("ok");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.turn_id).toBe("7");
    expect(sent[0]!.text).toBe("안녕");
    expect(sent[0]!.client_context).toMatch(/^<client_context>\n/);
    expect(sent[0]!.client_context).toMatch(/<\/client_context>$/);
    expect(sent[0]!.client_context).toContain("trigger: user message");
  });

  it("speaks nothing now — the reply arrives later as its own render frame", async () => {
    await callerWith(true).call(turnOf(userEnv(), 1));

    expect(turnOutput.speak).not.toHaveBeenCalled();
    expect(turnOutput.delta).not.toHaveBeenCalled();
    expect(turnOutput.abort).not.toHaveBeenCalled();
    expect(spoke).toEqual([false]);
  });

  it("a turn the user typed stops the speech and the outstanding turns, before the context is built", async () => {
    await callerWith(true).call(turnOf(userEnv(), 1));

    expect(order).toEqual(["interrupt", "cut", "context"]);
  });

  it("a turn no user spoke leaves the speech and the outstanding turns alone", async () => {
    await callerWith(true).call(turnOf(scheduleEnv(), 2));

    expect(turnOutput.interrupt).not.toHaveBeenCalled();
    expect(cuts).toBe(0);
  });

  it("a call superseded before it started stops neither the speech nor the turns", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await callerWith(true).call(turnOf(userEnv(), 1), controller.signal);

    expect(outcome).toBe("superseded_by_user");
    expect(order).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a call a newer turn overtook while its context was building never reaches the socket", async () => {
    const controller = new AbortController();
    const caller = callerWith(true);
    onContextBuilt = () => controller.abort();
    const outcome = await caller.call(turnOf(userEnv(), 1), controller.signal);

    expect(outcome).toBe("superseded_by_user");
    expect(sent).toEqual([]);
    expect(sentIds).toEqual([]);
  });

  it("reports the turn id the socket accepted", async () => {
    await callerWith(true).call(turnOf(userEnv(), 7));

    expect(sentIds).toEqual(["7"]);
  });

  it("reports no turn id when the socket refused the frame", async () => {
    await callerWith(false).call(turnOf(userEnv(), 7));

    expect(sentIds).toEqual([]);
  });

  it("writes one turn record with spoke_text false for the handover", async () => {
    await callerWith(true).call(turnOf(userEnv(), 1));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "turn",
      event_name: "user.text_submitted",
      trigger_kind: "user",
      spoke_text: false,
    });
  });

  it("puts the user utterance in the transcript, as the other modes do", async () => {
    await callerWith(true).call(turnOf(userEnv("안녕"), 1));

    expect(transcript).toEqual([{ role: "user", text: "안녕", ts: expect.any(Number) }]);
  });

  it("writes nothing to the transcript for a turn no user spoke", async () => {
    const caller = callerWith(true);
    await caller.call(turnOf(scheduleEnv(), 2));

    expect(transcript).toEqual([]);
  });

  it("keeps the utterance out of a conversation the user reset to mid-turn", async () => {
    const caller = callerWith(true);
    onTurnSent = () => {
      sessionToken = "s-2";
    };
    await caller.call(turnOf(userEnv(), 1));

    expect(transcript).toEqual([]);
  });

  it("writes nothing to the transcript when the socket refused the turn", async () => {
    await callerWith(false).call(turnOf(userEnv(), 1));

    expect(transcript).toEqual([]);
  });

  it("appends the sent context to the context history", async () => {
    await callerWith(true).call(turnOf(userEnv(), 1));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ event_name: "user.text_submitted", trigger_kind: "user" });
  });

  it("a socket that is not ready ends the turn as a network drop", async () => {
    const outcome = await callerWith(false).call(turnOf(userEnv(), 1));

    expect(outcome).toBe("network_drop");
    expect(records).toEqual([]);
    expect(contexts).toEqual([]);
  });

  it("a turn no user spoke sends an empty utterance", async () => {
    await callerWith(true).call(turnOf(scheduleEnv(), 2));

    expect(sent[0]!.text).toBe("");
  });

  it("an unconfigured chat endpoint settles before the socket is touched", async () => {
    const outcome = await callerWith(true, { ...PUSH_CONFIG, chat_base_url: "" }).call(
      turnOf(userEnv(), 1),
    );

    expect(outcome).toBe("not_configured");
    expect(sent).toEqual([]);
  });
});

/** Tracks a call still running: the outcome stays null until the wait ends. */
function running(promise: Promise<TurnOutcome>) {
  let settled: TurnOutcome | null = null;
  void promise.then((outcome) => {
    settled = outcome;
  });
  return { settled: (): TurnOutcome | null => settled, promise };
}

/** Every way the wait ends, with the outcome it settles to. */
const EXITS = [
  ["the turn's turn_end", "ok", "ended"],
  ["the user stopping the reply", "superseded_by_user", "cut"],
  ["the external signal", "superseded_by_user", "abort"],
  ["240 seconds with no frame", "network_stall", "timeout"],
  ["the socket leaving ready", "network_drop", "drop"],
] as const;

type Exit = (typeof EXITS)[number][2];

/** Sends one push turn and ends its wait the named way; resolves to the call's outcome. */
async function runToExit(exit: Exit): Promise<TurnOutcome> {
  const controller = new AbortController();
  const caller = callerWith(true);
  const call = caller.call(turnOf(userEnv(), 7), controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  if (exit === "ended") pushTurns.ended("7");
  if (exit === "cut") pushTurns.cut();
  if (exit === "abort") controller.abort();
  if (exit === "drop") socket.leaveReady();
  if (exit === "timeout") await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS);
  await vi.advanceTimersByTimeAsync(0);
  return call;
}

describe("backend_caller — push transport, the turn stays open", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autoRender = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays open after a render and resolves ok on the turn's turn_end", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBeNull();

    pushTurns.rendered("7");
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBeNull();

    pushTurns.ended("7");
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBe("ok");
  });

  it("restarts the frame wait on every frame of the turn", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(200_000);
    pushTurns.rendered("7");
    await vi.advanceTimersByTimeAsync(200_000);

    expect(turn.settled()).toBeNull();

    pushTurns.ended("7");
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBe("ok");
  });

  it("names the tool a tool_status frame carries to the phrase sink and re-arms the frame wait", async () => {
    const caller = callerWith(true);
    const call = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS - 1);
    pushTurns.toolStatus("7", "running", "read_file");
    await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS - 1);

    expect(turnOutput.toolStatus).toHaveBeenCalledWith(7, "running", "read_file");
    expect(call.settled()).toBeNull();

    pushTurns.ended("7");
    await vi.advanceTimersByTimeAsync(0);

    expect(call.settled()).toBe("ok");
  });

  it("another turn's render leaves it open", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);
    pushTurns.rendered("9");
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBeNull();
  });

  it("a render then 240 seconds of silence resolves ok with a turn-end stall logged", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);
    pushTurns.rendered("7");

    await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS);

    expect(turn.settled()).toBe("ok");
    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "push_turn_end", turn_id: "7" }),
    );
  });

  it("the socket leaving ready after a render resolves ok with a turn-end drop logged", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);
    pushTurns.rendered("7");

    socket.leaveReady();
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBe("ok");
    expect(logger.warn).toHaveBeenCalledWith(
      "network_drop",
      expect.objectContaining({ stage: "push_turn_end", turn_id: "7" }),
    );
  });

  it("records the user's half of the turn at send, before the wait", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv("안녕"), 7)));
    await vi.advanceTimersByTimeAsync(0);

    expect(turn.settled()).toBeNull();
    expect(sentIds).toEqual(["7"]);
    expect(spoke).toEqual([false]);
    expect(transcript).toEqual([{ role: "user", text: "안녕", ts: expect.any(Number) }]);
    expect(contexts).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it.each(EXITS)("%s ends the turn as %s", async (_label, outcome, exit) => {
    await expect(runToExit(exit)).resolves.toBe(outcome);
  });

  it("logs the expired wait as a stall of the push wait", async () => {
    await runToExit("timeout");

    expect(logger.warn).toHaveBeenCalledWith(
      "network_stall",
      expect.objectContaining({ stage: "push_wait", turn_id: "7" }),
    );
  });

  it("logs the socket leaving ready as a drop of the push wait", async () => {
    await runToExit("drop");

    expect(logger.warn).toHaveBeenCalledWith(
      "network_drop",
      expect.objectContaining({ stage: "push_wait", turn_id: "7" }),
    );
  });

  it("holds the wait for the whole budget before it expires", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(PRE_SPEECH_TIMEOUT_MS - 1);

    expect(turn.settled()).toBeNull();

    await vi.advanceTimersByTimeAsync(1);

    expect(turn.settled()).toBe("network_stall");
  });

  it.each(EXITS)("%s leaves no timer or subscriber behind", async (_label, _outcome, exit) => {
    await runToExit(exit);

    expect(vi.getTimerCount()).toBe(0);
    expect(socket.subscriberCount()).toBe(0);
  });

  it.each(EXITS)("%s leaves no waiter behind in the store", async (_label, _outcome, exit) => {
    await runToExit(exit);

    expect(abandoned).toEqual(["7"]);
  });

  it("a session reset mid-wait supersedes the call and drops the turn's late render", async () => {
    const caller = callerWith(true);
    const controller = new AbortController();
    const renderTurn = createRenderTurn({
      turnOutput,
      pushTurns,
      appendTranscript: (entry) => transcript.push(entry),
      logger,
    });
    const call = caller.call(turnOf(userEnv("안녕"), 7), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(transcript).toEqual([{ role: "user", text: "안녕", ts: expect.any(Number) }]);

    // The reset path the panel runs: the stop closure first, then the reset frame.
    controller.abort();
    pushTurns.cut();

    await expect(call).resolves.toBe("superseded_by_user");

    expect(pushTurns.isCut("7")).toBe(true);
    expect(
      renderTurn.render({
        type: "render",
        turn_id: "7",
        source: "hermes",
        segments: [{ speech: "Too late." }],
      }),
    ).toBe(false);
    expect(transcript).toEqual([{ role: "user", text: "안녕", ts: expect.any(Number) }]);
  });
});

describe("backend_caller — push transport, the thinking bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autoRender = false;
    turnOutput.hasFiller.mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the thinking bridge at the first render, exactly once", async () => {
    const caller = callerWith(true);
    const turn = running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);

    expect(turnOutput.thinkingStart).toHaveBeenCalledWith(7);
    expect(turnOutput.thinkingEnd).not.toHaveBeenCalled();
    expect(turn.settled()).toBeNull();

    pushTurns.rendered("7");
    await vi.advanceTimersByTimeAsync(0);

    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
    expect(turn.settled()).toBeNull();

    pushTurns.rendered("7");
    pushTurns.ended("7");
    await turn.promise;

    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });

  it("shows no thinking bridge on a reflex turn", async () => {
    const caller = callerWith(true);
    running(caller.call(turnOf(touchEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);

    expect(turnOutput.thinkingStart).not.toHaveBeenCalled();

    pushTurns.rendered("7");
    await vi.advanceTimersByTimeAsync(0);
  });

  it("shows no thinking bridge when the filler pool is empty", async () => {
    turnOutput.hasFiller.mockReturnValue(false);
    const caller = callerWith(true);
    running(caller.call(turnOf(userEnv(), 7)));
    await vi.advanceTimersByTimeAsync(0);

    expect(turnOutput.thinkingStart).not.toHaveBeenCalled();

    pushTurns.rendered("7");
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(EXITS)("%s ends the thinking bridge exactly once", async (_label, _outcome, exit) => {
    await runToExit(exit);

    expect(turnOutput.thinkingStart).toHaveBeenCalledTimes(1);
    expect(turnOutput.thinkingEnd).toHaveBeenCalledTimes(1);
  });
});
