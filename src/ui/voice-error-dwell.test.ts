/**
 * voice-error-dwell.test.ts
 *
 * The voice indicator's error dwell. A transient failure self-clears back to
 * listening so the chip does not sit red forever; a settings-fixable one holds,
 * because a fix affordance that vanishes mid-reach is worse than none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceErrorDwell,
  VOICE_TURN_ERROR_DISPLAY_MS,
  VOICE_TURN_FIX_HOLD_MS,
} from "./voice-error-dwell";
import { createVoiceInputStatus } from "./voice-input-status";

describe("createVoiceErrorDwell", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the error with the failure reason as the detail", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("network_drop");

    expect(status.get()).toMatchObject({ state: "error", detail: "network_drop" });
  });

  it("reverts a transient failure to listening after the display window", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("network_drop");

    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS);

    expect(status.get().state).toBe("listening");
  });

  it("holds a not_configured failure well past the transient window", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("not_configured");

    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS * 10);

    expect(status.get()).toMatchObject({ state: "error", detail: "not_configured" });
  });

  // The fix chip takes OS pointer events, so an unattended one would swallow
  // clicks meant for whatever sits behind YUI. The hold is generous, not endless.
  it("caps the hold — a not_configured error reverts to listening after the fix window", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("not_configured");

    vi.advanceTimersByTime(VOICE_TURN_FIX_HOLD_MS - 1);
    expect(status.get().state).toBe("error");

    vi.advanceTimersByTime(1);
    expect(status.get().state).toBe("listening");
  });

  it("gives a fixable failure a longer hold than a transient one", () => {
    expect(VOICE_TURN_FIX_HOLD_MS).toBeGreaterThan(VOICE_TURN_ERROR_DISPLAY_MS);
  });

  it("a held not_configured chip is not revived by a later transient revert", () => {
    const status = createVoiceInputStatus();
    const dwell = createVoiceErrorDwell(status);

    dwell.show("network_drop");
    dwell.show("not_configured");
    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS * 2);

    expect(status.get()).toMatchObject({ state: "error", detail: "not_configured" });
  });

  it("leaves a state the user moved on to alone when the timer fires", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("network_drop");
    status.set("idle");

    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS);

    expect(status.get().state).toBe("idle");
  });

  it("dispose cancels a pending revert", () => {
    const status = createVoiceInputStatus();
    const dwell = createVoiceErrorDwell(status);
    dwell.show("network_drop");

    dwell.dispose();
    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS);

    expect(status.get().state).toBe("error");
  });
});
