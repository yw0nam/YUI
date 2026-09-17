import { describe, expect, it, vi } from "vitest";
import { createVoiceInputStatus } from "./voice-input-status";

describe("createVoiceInputStatus", () => {
  it("starts idle and hidden", () => {
    const status = createVoiceInputStatus();

    expect(status.get()).toEqual({
      state: "idle",
      detail: "Voice input is off",
      visible: false,
    });
  });

  it("keeps error visible with a caller-provided detail", () => {
    const status = createVoiceInputStatus();

    status.set("error", "STT request failed");

    expect(status.get()).toEqual({
      state: "error",
      detail: "STT request failed",
      visible: true,
    });
  });

  it("skips notify when set repeats the same state and detail", () => {
    const status = createVoiceInputStatus();
    const listener = vi.fn();

    status.subscribe(listener);
    status.set("listening");
    status.set("listening");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies again when the same state carries a different detail", () => {
    const status = createVoiceInputStatus();
    const listener = vi.fn();

    status.subscribe(listener);
    status.set("error", "a");
    status.set("error", "b");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const status = createVoiceInputStatus();
    const listener = vi.fn();

    const unsubscribe = status.subscribe(listener);
    status.set("listening");
    unsubscribe();
    status.set("asr");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      state: "listening",
      detail: "Speech active",
      visible: true,
    });
  });
});
