/**
 * quoted-turn.test.ts — the admitted user turn the bubble quotes, and what was observed of it.
 *
 * A real turn log drives settlement; the surface port is a set of spies.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BusEnvelope } from "../core/event-bus";
import { userEnv } from "../test-helpers";
import { createQuotedTurn, type QuotedTurn, type QuoteSurfaces } from "./quoted-turn";
import { createTurnLog, type TurnLog } from "./turn";

const IMAGE = "data:image/jpeg;base64,x";

function voiceEnv(text: string): BusEnvelope {
  return {
    source: "user_input_source",
    event_name: "user.voice_segment_ready",
    ts: 0,
    payload: { text },
    dnd_override: true,
  };
}

function proactiveEnv(): BusEnvelope {
  return { source: "timer_scheduler", event_name: "proactive.idle", ts: 0 };
}

describe("createQuotedTurn", () => {
  let turnLog: TurnLog;
  let surfaces: { [K in keyof QuoteSurfaces]: Mock<QuoteSurfaces[K]> };
  let quoted: QuotedTurn;

  beforeEach(() => {
    turnLog = createTurnLog();
    surfaces = {
      quoteUser: vi.fn(),
      settleQuote: vi.fn(),
      clearQuote: vi.fn(),
      restoreInput: vi.fn(),
    };
    quoted = createQuotedTurn({ surfaces, turnLog });
  });

  function admit(env: BusEnvelope) {
    const turn = turnLog.begin(env);
    quoted.admitted(turn);
    return turn;
  }

  it("quotes an admitted typed turn with its text and image count", () => {
    admit({ ...userEnv("hi"), payload: { text: "hi", images: [IMAGE] } });

    expect(surfaces.quoteUser).toHaveBeenCalledWith({ text: "hi", via: "text", images: 1 });
  });

  it("quotes an admitted voice turn as voice", () => {
    admit(voiceEnv("hello"));

    expect(surfaces.quoteUser).toHaveBeenCalledWith({ text: "hello", via: "voice", images: 0 });
  });

  it("an admitted turn the user did not start settles the quote", () => {
    admit(userEnv("hi"));

    admit(proactiveEnv());

    expect(surfaces.settleQuote).toHaveBeenCalledTimes(1);
    expect(surfaces.clearQuote).not.toHaveBeenCalled();
    expect(surfaces.quoteUser).toHaveBeenCalledTimes(1);
  });

  it("a failure before any utterance restores the text and images and clears the quote", () => {
    const turn = admit({ ...userEnv("hi"), payload: { text: "hi", images: [IMAGE] } });

    quoted.failed(turn);

    expect(surfaces.restoreInput).toHaveBeenCalledWith("hi", [IMAGE]);
    expect(surfaces.clearQuote).toHaveBeenCalledTimes(1);
    expect(surfaces.restoreInput.mock.invocationCallOrder[0]).toBeLessThan(
      surfaces.clearQuote.mock.invocationCallOrder[0],
    );
    expect(surfaces.settleQuote).not.toHaveBeenCalled();
  });

  it("a guide turn that fails before any utterance clears the quote and restores nothing", () => {
    const turn = admit({
      ...userEnv("YUI 조작법 알려줘"),
      payload: { text: "YUI 조작법 알려줘", guide: "controls" },
    });

    quoted.failed(turn);

    expect(surfaces.clearQuote).toHaveBeenCalledTimes(1);
    expect(surfaces.restoreInput).not.toHaveBeenCalled();
  });

  it("a failure after the utterance opened settles the quote and restores nothing", () => {
    const turn = admit(userEnv("hi"));

    quoted.utteranceStart();
    quoted.failed(turn);

    expect(surfaces.settleQuote).toHaveBeenCalledTimes(1);
    expect(surfaces.restoreInput).not.toHaveBeenCalled();
    expect(surfaces.clearQuote).not.toHaveBeenCalled();
  });

  it("a voice failure before any utterance clears the quote and restores nothing", () => {
    const turn = admit(voiceEnv("hello"));

    quoted.failed(turn);

    expect(surfaces.clearQuote).toHaveBeenCalledTimes(1);
    expect(surfaces.restoreInput).not.toHaveBeenCalled();
  });

  it("settlement releases the quote once", () => {
    const turn = admit(userEnv("hi"));

    turnLog.settle(turn.id);
    turnLog.setAudioOwed(true);
    turnLog.setAudioOwed(false);

    expect(surfaces.settleQuote).toHaveBeenCalledTimes(1);
  });

  it("a second user turn replaces the quote and the first turn's stale settle is ignored", () => {
    const first = admit(userEnv("one"));
    const second = admit(userEnv("two"));

    turnLog.settle(first.id);
    expect(surfaces.settleQuote).not.toHaveBeenCalled();

    turnLog.settle(second.id);
    expect(surfaces.settleQuote).toHaveBeenCalledTimes(1);
    expect(surfaces.quoteUser).toHaveBeenLastCalledWith({ text: "two", via: "text", images: 0 });
  });

  it("dispose stops the settlement subscription", () => {
    const turn = admit(userEnv("hi"));

    quoted.dispose();
    turnLog.settle(turn.id);

    expect(surfaces.settleQuote).not.toHaveBeenCalled();
  });
});
