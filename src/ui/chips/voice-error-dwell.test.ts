/**
 * voice-error-dwell.test.ts
 *
 * The status pill's voice error dwell. A voice-turn failure self-clears back to
 * listening so the mic does not sit red forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceErrorDwell, VOICE_TURN_ERROR_DISPLAY_MS } from "./voice-error-dwell";
import { createVoiceInputStatus } from "./voice-input-status";

describe("createVoiceErrorDwell", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the error with the failure reason as the detail", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("network_drop");

    expect(status.get()).toMatchObject({ state: "error", detail: "network_drop" });
  });

  it("carries the server's message beside the failure reason", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("network_drop", "rate limit reached");

    expect(status.get()).toMatchObject({
      state: "error",
      detail: "network_drop",
      message: "rate limit reached",
    });
  });

  it("reverts a transient failure to listening after the display window", () => {
    const status = createVoiceInputStatus();
    createVoiceErrorDwell(status).show("network_drop");

    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS);

    expect(status.get().state).toBe("listening");
  });

  it("restarts the display window on a newer failure", () => {
    const status = createVoiceInputStatus();
    const dwell = createVoiceErrorDwell(status);

    dwell.show("network_drop");
    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS - 1);
    dwell.show("network_stall");
    vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS - 1);

    expect(status.get()).toMatchObject({ state: "error", detail: "network_stall" });
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

  describe("with a voice host", () => {
    it("reverts to listening while the host still wants the mic", () => {
      const status = createVoiceInputStatus();
      createVoiceErrorDwell(status, { wanted: () => true }).show("network_drop");

      vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS);

      expect(status.get().state).toBe("listening");
    });

    it("reads wanted() when the hold ends, not when the error is shown", () => {
      const status = createVoiceInputStatus();
      let wanted = true;
      createVoiceErrorDwell(status, { wanted: () => wanted }).show("network_drop");
      wanted = false;

      vi.advanceTimersByTime(VOICE_TURN_ERROR_DISPLAY_MS);

      expect(status.get().state).toBe("idle");
    });
  });
});
