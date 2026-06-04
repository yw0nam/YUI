/**
 * apply-directive.test.ts — TDD red phase for Renderer.applyDirective (#16a, render-wiring half).
 *
 * These tests MUST FAIL against the stub (`routeDirective` does not yet exist).
 * They encode contract.md §3 "렌더 규약" (render rules) + §1 hold-on-null semantics that
 * applyDirective must obey when routing a ControlEnvelope into setEmotion(#6) / playMotion(#5).
 *
 * Source of truth (contract.md):
 *  - §3 render rule 1 (line 284): emotion present → expression transition; ABSENT → hold previous.
 *  - §3 render rule 2 (line 285): motion present → registry lookup + play; ABSENT or null → idle.
 *  - §1 (line 84): `emotion === null` OR absent → NO-OP (hold previous); only explicit
 *    `{id:"neutral"}` transitions to neutral. `setEmotion(null)` is itself a NO-OP hold (#6).
 *  - §3 render rule 6 (line 289): `_reserved` is ignored in v0.
 *
 * `should_speak` / `speech_text` / `tool_status` / `rich_content` are NOT this routing layer's
 * concern (other tracks) — routeDirective must touch only the emotion + motion render channels.
 *
 * Pure routing: no real VRM / GPU. setEmotion & playMotion are vi.fn() spies.
 */

import { describe, it, expect, vi } from "vitest";
import { routeDirective } from "./apply-directive";
import type { ControlEnvelope, EmotionSignal, MotionSignal } from "../contract";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a spy pair + a route() bound to them. */
function makeHarness() {
  const setEmotion = vi.fn<(e: EmotionSignal | null) => void>();
  const playMotion = vi.fn<(m: MotionSignal | null) => void>();
  const route = (env: ControlEnvelope): void =>
    routeDirective(env, { setEmotion, playMotion });
  return { setEmotion, playMotion, route };
}

/** Minimal envelope — speech_text is required by the type but irrelevant to routing. */
function env(partial: Partial<ControlEnvelope>): ControlEnvelope {
  return { speech_text: "", ...partial };
}

const HAPPY: EmotionSignal = { id: "happy", intensity: 0.6, transition_ms: 300 };
const NEUTRAL: EmotionSignal = { id: "neutral" };
const WAVE: MotionSignal = { id: "happy" };

// ─────────────────────────────────────────────────────────────────────────────
// Emotion routing (contract §3 rule 1 + §1 line 84)
// ─────────────────────────────────────────────────────────────────────────────

describe("routeDirective — emotion channel", () => {
  it("emotion present (non-null) → setEmotion called with the exact signal", () => {
    const { setEmotion, route } = makeHarness();
    route(env({ emotion: HAPPY }));
    expect(setEmotion).toHaveBeenCalledTimes(1);
    expect(setEmotion).toHaveBeenCalledWith(HAPPY);
  });

  it("explicit {id:'neutral'} → forwarded verbatim (only this transitions to neutral)", () => {
    const { setEmotion, route } = makeHarness();
    route(env({ emotion: NEUTRAL }));
    expect(setEmotion).toHaveBeenCalledWith(NEUTRAL);
  });

  it("emotion ABSENT → hold previous: setEmotion is NOT called", () => {
    // §1 line 84: absent → NO-OP hold. Cleanest hold = no expression change at all.
    const { setEmotion, route } = makeHarness();
    route(env({ motion: WAVE }));
    expect(setEmotion).not.toHaveBeenCalled();
  });

  it("emotion present-but-null → hold: routed as setEmotion(null) NO-OP, never a non-null id", () => {
    // §1 line 84: null → NO-OP hold, same observable behavior as absent.
    const { setEmotion, route } = makeHarness();
    route(env({ emotion: null }));
    // Either skipped or called with null — but MUST NOT be called with any non-null signal.
    for (const call of setEmotion.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("unregistered / unknown emotion id is forwarded untouched (resolver owns fallback, not routing)", () => {
    const { setEmotion, route } = makeHarness();
    const weird = { id: "made_up_emotion" } as unknown as EmotionSignal;
    route(env({ emotion: weird }));
    expect(setEmotion).toHaveBeenCalledWith(weird);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Motion routing (contract §3 rule 2)
// ─────────────────────────────────────────────────────────────────────────────

describe("routeDirective — motion channel", () => {
  it("motion present → playMotion called with the exact signal", () => {
    const { playMotion, route } = makeHarness();
    route(env({ motion: WAVE }));
    expect(playMotion).toHaveBeenCalledTimes(1);
    expect(playMotion).toHaveBeenCalledWith(WAVE);
  });

  it("motion ABSENT → return to idle: playMotion(null)", () => {
    // §3 rule 2: absent → idle (active return, unlike emotion's passive hold).
    const { playMotion, route } = makeHarness();
    route(env({ emotion: HAPPY }));
    expect(playMotion).toHaveBeenCalledTimes(1);
    expect(playMotion).toHaveBeenCalledWith(null);
  });

  it("motion explicitly null → return to idle: playMotion(null)", () => {
    const { playMotion, route } = makeHarness();
    route(env({ motion: null }));
    expect(playMotion).toHaveBeenCalledTimes(1);
    expect(playMotion).toHaveBeenCalledWith(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined cases (the four quadrants of presence)
// ─────────────────────────────────────────────────────────────────────────────

describe("routeDirective — combined", () => {
  it("both present → both channels fire with their signals", () => {
    const { setEmotion, playMotion, route } = makeHarness();
    route(env({ emotion: HAPPY, motion: WAVE }));
    expect(setEmotion).toHaveBeenCalledWith(HAPPY);
    expect(playMotion).toHaveBeenCalledWith(WAVE);
  });

  it("neither present → hold expression (no setEmotion) + idle (playMotion null)", () => {
    const { setEmotion, playMotion, route } = makeHarness();
    route(env({}));
    expect(setEmotion).not.toHaveBeenCalled();
    expect(playMotion).toHaveBeenCalledTimes(1);
    expect(playMotion).toHaveBeenCalledWith(null);
  });

  it("emotion only → setEmotion fires, motion returns to idle", () => {
    const { setEmotion, playMotion, route } = makeHarness();
    route(env({ emotion: HAPPY }));
    expect(setEmotion).toHaveBeenCalledWith(HAPPY);
    expect(playMotion).toHaveBeenCalledWith(null);
  });

  it("motion only → playMotion fires, expression held (no setEmotion)", () => {
    const { setEmotion, playMotion, route } = makeHarness();
    route(env({ motion: WAVE }));
    expect(playMotion).toHaveBeenCalledWith(WAVE);
    expect(setEmotion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Out-of-scope fields must NOT leak into the render channels (§3 rules 3–6)
// ─────────────────────────────────────────────────────────────────────────────

describe("routeDirective — ignores non-render fields", () => {
  it("should_speak / speech_text / tool_status / rich_content / _reserved do not affect routing", () => {
    const { setEmotion, playMotion, route } = makeHarness();
    route(
      env({
        should_speak: false,
        speech_text: "hello there",
        tool_status: { state: "running", label: "검색 중…", tool_id: "web_search" },
        rich_content: [{ kind: "link", url: "https://x", title: "x" }],
        _reserved: { visemes: [1, 2, 3] },
        emotion: HAPPY,
        motion: WAVE,
      }),
    );
    // Only the render channels are driven, and only by emotion/motion.
    expect(setEmotion).toHaveBeenCalledTimes(1);
    expect(setEmotion).toHaveBeenCalledWith(HAPPY);
    expect(playMotion).toHaveBeenCalledTimes(1);
    expect(playMotion).toHaveBeenCalledWith(WAVE);
  });
});
