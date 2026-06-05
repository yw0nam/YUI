import { describe, expect, it, vi } from "vitest";
import { createVoiceInputStatus } from "./voice-input-status";

describe("createVoiceInputStatus", () => {
  it("starts idle and hidden", () => {
    const status = createVoiceInputStatus();

    expect(status.get()).toEqual({
      state: "idle",
      label: "Idle",
      detail: "Voice input is off",
      visible: false,
    });
  });

  it("maps runtime states to short screen labels", () => {
    const status = createVoiceInputStatus();

    status.set("listening");
    expect(status.get()).toMatchObject({
      state: "listening",
      label: "듣는 중",
      visible: true,
    });

    status.set("asr");
    expect(status.get()).toMatchObject({
      state: "asr",
      label: "ASR 전송",
      visible: true,
    });

    status.set("fired");
    expect(status.get()).toMatchObject({
      state: "fired",
      label: "전달됨",
      visible: true,
    });
  });

  it("keeps error visible with a caller-provided detail", () => {
    const status = createVoiceInputStatus();

    status.set("error", "STT request failed");

    expect(status.get()).toEqual({
      state: "error",
      label: "오류",
      detail: "STT request failed",
      visible: true,
    });
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
      label: "듣는 중",
      detail: "Speech active",
      visible: true,
    });
  });
});
