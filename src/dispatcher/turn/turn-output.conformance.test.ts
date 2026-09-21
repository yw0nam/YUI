/**
 * turn-output.conformance.test.ts — one logical reply, routed through either transport, reaches
 * the voice pipeline port (TurnOutput + renderer) with the same cue content and order, the same
 * text after whitespace collapse, the same rendered expression and one close.
 *
 * Not compared: the thinking-motion hold `cue` respects and `cueWithSpeech` bypasses (no filler
 * here, so no hold is armed), the playback boundary a silent cue waits on, and `releaseMute`.
 * The stream deltas are cut at the push segment boundaries, and a completed envelope echoes its
 * express args. The sentence boundary push appends is pinned in render-turn.cue-order.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { wirePushTransport } from "../../app/wire-push";
import type { ControlEnvelope, ExpressArgs } from "../../contract";
import { createDelegationsStore } from "../../io/bridge/delegations-store";
import { createReasoningStore } from "../../io/bridge/reasoning-store";
import type { ChatStreamEvent } from "../../io/chat/chat-client";
import type { RenderFrame } from "../../io/chat/push-socket";
import { createBackendCaller } from "../backend/backend-caller";
import {
  CONFIG,
  completedEvent,
  createScriptedStream,
  deltaEvent,
  expressEvent,
  makeLogger,
  makeTurnOutput,
  turnOf,
  userEnv,
} from "../test-helpers";
import { createPushTurns } from "./push-turn";
import { createTurnFeed } from "./turn-feed";

const CUE_A: ExpressArgs = { emotion_id: "happy", motion_id: "nod" };
const CUE_B: ExpressArgs = {
  emotion_id: "curious",
  motion_id: "tilt",
  emotion_text: "softly",
  caption: "leaning in",
};

type Entry =
  | { cue: ExpressArgs }
  | { text: string }
  | { expression: { emotion?: string; motion?: string } }
  | { close: true };

/** Every field the contract carries, so one a path drops shows up as an inequality. */
function cueOf(args: ExpressArgs): ExpressArgs {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

/** TurnOutput + renderer fakes that record one shared, ordered entry list per side. */
function recordingSinks() {
  const entries: Entry[] = [];
  const turnOutput = makeTurnOutput();
  turnOutput.hasOutstandingSpeech.mockReturnValue(false);
  // The fake drains at once, so a cue routed through the playback boundary still lands in the list.
  turnOutput.onQueueDrained.mockImplementation((cb: () => void) => cb());
  turnOutput.cue.mockImplementation((args: ExpressArgs) => entries.push({ cue: cueOf(args) }));
  turnOutput.cueWithSpeech.mockImplementation((args: ExpressArgs) =>
    entries.push({ cue: cueOf(args) }),
  );
  turnOutput.delta.mockImplementation((text: string) => entries.push({ text }));
  turnOutput.speak.mockImplementation((text: string) => entries.push({ text }));
  turnOutput.end.mockImplementation(() => entries.push({ close: true }));
  turnOutput.silentCue.mockImplementation((args: ExpressArgs) =>
    entries.push({ expression: { emotion: args.emotion_id, motion: args.motion_id } }),
  );
  const renderer = {
    // An envelope with no motion still reaches the body: the renderer returns it to idle.
    applyDirective: vi.fn((envelope: ControlEnvelope) => {
      entries.push({ expression: { emotion: envelope.emotion?.id, motion: envelope.motion?.id } });
    }),
  };
  return { entries, renderer, turnOutput };
}

/** The pipeline consumes a pending cue only at sentence submission and drops it on dispose, so a
 *  cue no text follows before the close never reaches the body. Holds while every text run ends
 *  at a sentence terminator: the close flushes an unterminated tail, which would consume the cue. */
function normalize(entries: Entry[]): Entry[] {
  const speaksAfter = (from: number): boolean => {
    for (let j = from + 1; j < entries.length; j++) {
      if ("text" in entries[j]!) return true;
      if ("close" in entries[j]!) return false;
    }
    return false;
  };
  const merged: Entry[] = [];
  for (const [i, entry] of entries.entries()) {
    if ("cue" in entry) {
      if (speaksAfter(i)) merged.push({ cue: entry.cue });
    } else if ("text" in entry) {
      const prev = merged.at(-1);
      if (prev && "text" in prev) prev.text += entry.text;
      else merged.push({ text: entry.text });
    } else {
      merged.push(entry);
    }
  }
  return merged.map((entry) =>
    "text" in entry ? { text: entry.text.replace(/\s+/g, " ").trim() } : entry,
  );
}

async function runStream(events: ChatStreamEvent[]): Promise<Entry[]> {
  const { entries, renderer, turnOutput } = recordingSinks();
  const script = createScriptedStream();
  script.events = events;
  const caller = createBackendCaller({
    config: CONFIG,
    renderer,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    stream: script.stream,
    turnOutput,
    logger: makeLogger(),
  });
  expect(await caller.call(turnOf(userEnv()))).toBe("ok");
  return entries;
}

function runPush(frame: RenderFrame): Entry[] {
  const { entries, turnOutput } = recordingSinks();
  let onRender: ((frame: RenderFrame) => void) | null = null;
  const dispose = wirePushTransport({
    socket: {
      onRender(cb) {
        onRender = cb;
        return () => {};
      },
      onSpeech: () => () => {},
      onTurnEnd: () => () => {},
      onToolStatus: () => () => {},
      onDelegations: () => () => {},
      onReasoning: () => () => {},
      onState: () => () => {},
    },
    turnOutput,
    pushTurns: createPushTurns(),
    delegations: createDelegationsStore(),
    delegationHistory: { merge: () => {} },
    turnFeed: createTurnFeed({ onToolStatus: () => {}, reasoning: createReasoningStore() }),
    appendTurnRecord: () => {},
    appendTranscript: () => {},
    log: makeLogger(),
  });
  onRender!(frame);
  dispose();
  return entries;
}

describe("turn-output conformance", () => {
  it("a speaking reply with one cue", async () => {
    const stream = await runStream([
      expressEvent(CUE_A),
      deltaEvent("Hello the"),
      deltaEvent("re, world."),
      deltaEvent(" Nice to meet you."),
      completedEvent({ speech_text: "Hello there, world. Nice to meet you." }),
    ]);
    const push = runPush({
      type: "render",
      turn_id: "hermes-1",
      source: "hermes",
      segments: [{ cues: [CUE_A], speech: "Hello there, world. Nice to meet you." }],
    });
    const expected: Entry[] = [
      { cue: { emotion_id: "happy", motion_id: "nod" } },
      { text: "Hello there, world. Nice to meet you." },
      { close: true },
    ];
    expect(normalize(stream)).toEqual(expected);
    expect(normalize(push)).toEqual(expected);
  });

  it("two sentences with a cue each", async () => {
    const stream = await runStream([
      expressEvent(CUE_A),
      deltaEvent("Good morning."),
      deltaEvent(" Did you sleep well?"),
      expressEvent(CUE_B),
      deltaEvent(" Let me know."),
      completedEvent({ speech_text: "Good morning. Did you sleep well? Let me know." }),
    ]);
    const push = runPush({
      type: "render",
      turn_id: "hermes-1",
      source: "hermes",
      segments: [
        { cues: [CUE_A], speech: "Good morning. Did you sleep well?" },
        { cues: [CUE_B], speech: "Let me know." },
      ],
    });
    const expected: Entry[] = [
      { cue: { emotion_id: "happy", motion_id: "nod" } },
      { text: "Good morning. Did you sleep well?" },
      { cue: CUE_B },
      { text: "Let me know." },
      { close: true },
    ];
    expect(normalize(stream)).toEqual(expected);
    expect(normalize(push)).toEqual(expected);
  });

  it("a silent reply that carries an expression", async () => {
    const stream = await runStream([
      expressEvent(CUE_A),
      completedEvent({ speech_text: "", emotion: { id: "happy" }, motion: { id: "nod" } }),
    ]);
    const push = runPush({
      type: "render",
      turn_id: "hermes-1",
      source: "hermes",
      segments: [{ cues: [CUE_A] }],
    });
    const expected: Entry[] = [{ expression: { emotion: "happy", motion: "nod" } }];
    expect(normalize(stream)).toEqual(expected);
    expect(normalize(push)).toEqual(expected);
  });

  it("a bare [SILENT] reply speaks nothing, and only the stream path returns the body to idle", async () => {
    const stream = await runStream([
      deltaEvent("[SILE"),
      deltaEvent("NT]"),
      completedEvent({ speech_text: "[SILENT]" }),
    ]);
    const push = runPush({
      type: "render",
      turn_id: "hermes-1",
      source: "hermes",
      segments: [{ speech: "[SILENT]" }],
    });
    // The stream path routes every completed envelope to the renderer, and one with no motion
    // idles the body; push renders only the cues a segment carries, so it leaves the body alone.
    expect(normalize(stream)).toEqual([{ expression: {} }]);
    expect(normalize(push)).toEqual([]);
  });
});
