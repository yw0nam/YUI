/**
 * backend-caller.push.test.ts — the push transport (chat_api: "push").
 *
 * The turn goes out as one frame on the WebSocket and nothing streams back: a sent frame ends the
 * turn silently, a socket that is not ready ends it as a network failure.
 *
 * Nothing the backend pushes stops speech here; a turn the user typed or spoke does, and stops the
 * push turns still outstanding with it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import type { ChatHistoryEntry } from "../io/chat-history-store";
import type { PushTurnFrame } from "../io/push-socket";
import type { Logger } from "../logger";
import { createBackendCaller } from "./backend-caller";
import type { BusEnvelope } from "./event-bus";
import { CONFIG, makeLogger, makeTurnOutput, turnOf, userEnv } from "./test-helpers";

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
      return accepted;
    },
    onPushTurnCut: () => {
      order.push("cut");
      cuts++;
    },
    onPushTurnSent: (turnId) => sentIds.push(turnId),
    reportSpokeText: (v) => spoke.push(v),
    contextHistory: { append: (entry) => contexts.push(entry) },
    appendTurnRecord: (record) => records.push(record),
    logger,
  });
}

beforeEach(() => {
  turnOutput = makeTurnOutput();
  logger = makeLogger();
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

  it("shows no thinking bridge even when filler is available", async () => {
    turnOutput.hasFiller.mockReturnValue(true);
    await callerWith(true).call(turnOf(userEnv(), 1));

    expect(turnOutput.thinkingStart).not.toHaveBeenCalled();
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
