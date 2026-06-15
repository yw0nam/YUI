/**
 * ease-emotion.test.ts — slow ease-to-neutral after a turn's TTS ends.
 *
 * The renderer holds the last emotion (setEmotion(null) is a NO-OP hold). When TTS playback
 * finishes we want the expression to drift gently back to neutral — implemented as an EXPLICIT
 * `{id:"neutral"}` transition (the only thing that returns to neutral per contract §1) with a
 * long transition_ms so it eases rather than snaps.
 *
 * This pins the pure decision (mirroring apply-directive's routeDirective): no three.js / VRM —
 * setEmotion is a spy. The actual crossfade machinery is reused unchanged by setEmotion.
 */

import { describe, expect, it, vi } from "vitest";
import type { EmotionSignal } from "../contract";
import { DEFAULT_EMOTION_REVERT_MS, revertEmotionToNeutral } from "./ease-emotion";

function spySink() {
  return { setEmotion: vi.fn<(e: EmotionSignal | null) => void>() };
}

describe("revertEmotionToNeutral — eases back to neutral", () => {
  it("forwards an explicit {id:'neutral'} transition with the given duration", () => {
    const sink = spySink();
    revertEmotionToNeutral(1200, sink);
    expect(sink.setEmotion).toHaveBeenCalledTimes(1);
    expect(sink.setEmotion).toHaveBeenCalledWith({ id: "neutral", transition_ms: 1200 });
  });

  it("uses a slow default duration when none is given (eases, not snaps)", () => {
    const sink = spySink();
    revertEmotionToNeutral(undefined, sink);
    expect(sink.setEmotion).toHaveBeenCalledWith({
      id: "neutral",
      transition_ms: DEFAULT_EMOTION_REVERT_MS,
    });
    // a slow ease, not the default 250ms snap-ish crossfade.
    expect(DEFAULT_EMOTION_REVERT_MS).toBeGreaterThanOrEqual(800);
  });

  it("never forwards null (that would be a NO-OP hold, the bug we are fixing)", () => {
    const sink = spySink();
    revertEmotionToNeutral(900, sink);
    expect(sink.setEmotion).not.toHaveBeenCalledWith(null);
    const arg = sink.setEmotion.mock.calls[0][0];
    expect(arg).not.toBeNull();
    expect(arg).toMatchObject({ id: "neutral" });
  });

  it("clamps a negative duration to 0 (resolver also clamps, but keep the signal sane)", () => {
    const sink = spySink();
    revertEmotionToNeutral(-100, sink);
    expect(sink.setEmotion).toHaveBeenCalledWith({ id: "neutral", transition_ms: 0 });
  });
});
