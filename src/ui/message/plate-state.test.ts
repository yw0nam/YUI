import { expect, it, vi } from "vitest";
import type { AskFrame } from "../../io/chat/push/push-frames";
import { withPlateState } from "./plate-state";

const frame: AskFrame = {
  type: "ask",
  ask: { ask_id: "a", prompt: "p", choices: [{ id: "deny", label: "Deny" }], text: false },
};

it("keeps the plate responding from a line's begin to its end or hide, and thinking while busy", () => {
  const plate = { setLive: vi.fn(), setBusy: vi.fn(), setWaiting: vi.fn() };
  const surfaces = {
    beginSpeech: vi.fn(),
    endSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    setBusy: vi.fn(),
    setAsks: vi.fn(),
  };
  const driven = withPlateState(plate, surfaces);

  driven.beginSpeech();
  expect(plate.setLive.mock.calls).toEqual([[true]]);
  expect(surfaces.beginSpeech).toHaveBeenCalledWith();
  driven.endSpeech({ defer: true });
  expect(plate.setLive.mock.calls).toEqual([[true], [false]]);
  expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
  driven.beginSpeech();
  driven.hideSpeech();
  expect(plate.setLive.mock.calls).toEqual([[true], [false], [true], [false]]);
  expect(surfaces.hideSpeech).toHaveBeenCalledOnce();

  driven.setBusy(true);
  expect(plate.setBusy).toHaveBeenCalledWith(true);
  expect(surfaces.setBusy).toHaveBeenCalledWith(true);
});

it("sets the plate waiting while asks are open, and forwards the frames", () => {
  const plate = { setLive: vi.fn(), setBusy: vi.fn(), setWaiting: vi.fn() };
  const surfaces = {
    beginSpeech: vi.fn(),
    endSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    setBusy: vi.fn(),
    setAsks: vi.fn(),
  };
  const driven = withPlateState(plate, surfaces);

  driven.setAsks([frame]);
  expect(plate.setWaiting).toHaveBeenCalledWith(true);
  expect(surfaces.setAsks).toHaveBeenCalledWith([frame]);

  driven.setAsks([]);
  expect(plate.setWaiting).toHaveBeenLastCalledWith(false);
  expect(surfaces.setAsks).toHaveBeenLastCalledWith([]);
});
