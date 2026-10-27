import { describe, expect, it, vi } from "vitest";
import { createUnifiedVoice } from "./unified-voice";

function setup(shown: boolean, bargeIn = true) {
  const deps = {
    shown: { get: () => shown },
    bargeIn: () => bargeIn,
    sendSegment: vi.fn(),
    submitHere: vi.fn(),
    emitStopTurns: vi.fn(),
  };
  const localStop = vi.fn();
  const voice = createUnifiedVoice(deps);
  voice.onStop(localStop);
  return { ...deps, localStop, voice };
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
    { shown: true, bargeIn: true, stops: 1 },
    { shown: true, bargeIn: false, stops: 0 },
    { shown: false, bargeIn: true, stops: 0 },
  ])("speech onset with %j asks every window to stop and stops here that many times", (row) => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const h = setup(row.shown, row.bargeIn);

    h.voice.speechActive();

    expect(h.emitStopTurns).toHaveBeenCalledTimes(row.stops);
    expect(h.localStop).toHaveBeenCalledTimes(row.stops);
  });
});
