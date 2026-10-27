import { describe, expect, it, vi } from "vitest";
import { createUnifiedVoice } from "./unified-voice";

function setup(shown: boolean, bargeIn = true) {
  const deps = {
    shown: { get: () => shown },
    bargeIn: () => bargeIn,
    sendSegment: vi.fn(),
    submitHere: vi.fn(),
    emitSpeechOnset: vi.fn(),
  };
  const voice = createUnifiedVoice(deps);
  return { ...deps, voice };
}

describe("createUnifiedVoice", () => {
  it("sends a segment to the unified window while it shows, and submits it here otherwise", () => {
    const shown = setup(true);
    const hidden = setup(false);

    shown.voice.segment("hi");
    hidden.voice.segment("hi");

    expect(shown.sendSegment).toHaveBeenCalledExactlyOnceWith("hi");
    expect(shown.submitHere).not.toHaveBeenCalled();
    expect(hidden.submitHere).toHaveBeenCalledExactlyOnceWith("hi");
    expect(hidden.sendSegment).not.toHaveBeenCalled();
  });

  it.each([
    { shown: true, bargeIn: true, onsets: 1 },
    { shown: true, bargeIn: false, onsets: 0 },
    { shown: false, bargeIn: true, onsets: 0 },
  ])("speech onset with %j tells the unified window only while it shows and barge-in is on", (row) => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const h = setup(row.shown, row.bargeIn);

    h.voice.speechActive();

    expect(h.emitSpeechOnset).toHaveBeenCalledTimes(row.onsets);
  });
});
