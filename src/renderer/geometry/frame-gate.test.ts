/**
 * frame-gate.test.ts
 *
 * The renderer's rAF loop runs uncapped only when the character is doing
 * something the eye must track at full refresh; when only ambient (blink/sway/
 * breath) is running it caps to a lower idle fps to spare the frame budget.
 *
 * Pure pieces, all DOM/GL-free so they're node-testable:
 *  - isMouthConverging(openValue): does the lipsync mouth-open amplitude read as
 *    actively animating?
 *  - isActive(state): are any VrmParticipants converging (pins/gaze/emotion/mouth,
 *    checked via vrm-participant's anyConverging), or is a non-idle motion clip
 *    playing?
 *  - shouldRenderFrame(nowMs, lastRenderMs, active, targetIdleFps, throttleEnabled):
 *    given the frame clock, do we draw this frame? Active ⇒ always; idle ⇒ only once
 *    the idle-fps interval has elapsed — unless throttling is disabled, which bypasses
 *    the idle cap entirely (render every frame).
 */

import { describe, expect, it } from "vitest";
import { isActive, isMouthConverging, shouldRenderFrame } from "./frame-gate";

describe("isMouthConverging", () => {
  it("is false at zero amplitude", () => {
    expect(isMouthConverging(0)).toBe(false);
  });

  it("is true while lipsync mouth amplitude is above the epsilon", () => {
    expect(isMouthConverging(0.3)).toBe(true);
  });

  it("treats a negligible mouth amplitude as idle", () => {
    expect(isMouthConverging(0.0005)).toBe(false);
  });
});

describe("isActive", () => {
  const idle = {
    participantsConverging: false,
    motionActive: false,
  };

  it("is false when only ambient is running (no active signal)", () => {
    expect(isActive(idle)).toBe(false);
  });

  it("is true while a VrmParticipant (pins/gaze/emotion/mouth) is converging", () => {
    expect(isActive({ ...idle, participantsConverging: true })).toBe(true);
  });

  it("is true while a non-idle motion clip is playing", () => {
    expect(isActive({ ...idle, motionActive: true })).toBe(true);
  });
});

describe("shouldRenderFrame", () => {
  const IDLE_FPS = 30;
  const IDLE_INTERVAL = 1000 / IDLE_FPS; // ~33.33ms

  it("always renders when active, regardless of elapsed time", () => {
    expect(shouldRenderFrame(1000, 1000, true, IDLE_FPS)).toBe(true);
    expect(shouldRenderFrame(1000.1, 1000, true, IDLE_FPS)).toBe(true);
  });

  it("skips an idle frame that arrives before the idle interval elapses", () => {
    // 16.6ms after the last render (full-refresh cadence) — too soon at 30fps cap.
    expect(shouldRenderFrame(1016.6, 1000, false, IDLE_FPS)).toBe(false);
  });

  it("renders an idle frame once the idle interval has elapsed", () => {
    expect(shouldRenderFrame(1000 + IDLE_INTERVAL, 1000, false, IDLE_FPS)).toBe(true);
    expect(shouldRenderFrame(1050, 1000, false, IDLE_FPS)).toBe(true);
  });

  it("renders the first idle frame when there is no prior render timestamp", () => {
    expect(shouldRenderFrame(1000, null, false, IDLE_FPS)).toBe(true);
  });

  it("bypasses the idle cap when throttling is disabled (renders every frame)", () => {
    // Disabled ⇒ even an idle frame arriving well before the idle interval renders.
    expect(shouldRenderFrame(1016.6, 1000, false, IDLE_FPS, false)).toBe(true);
    expect(shouldRenderFrame(1000.1, 1000, false, IDLE_FPS, false)).toBe(true);
  });

  it("applies the idle cap when throttling is enabled (default arg)", () => {
    // Explicit-enabled and default-omitted both cap idle frames.
    expect(shouldRenderFrame(1016.6, 1000, false, IDLE_FPS, true)).toBe(false);
    expect(shouldRenderFrame(1016.6, 1000, false, IDLE_FPS)).toBe(false);
  });
});
