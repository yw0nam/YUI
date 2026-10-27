import { expect, it, vi } from "vitest";
import { withPlateState } from "./plate-state";

it("keeps the plate responding from a line's begin to its end or hide, and thinking while busy", () => {
  const plate = { setLive: vi.fn(), setBusy: vi.fn() };
  const surfaces = {
    beginSpeech: vi.fn(),
    endSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    setBusy: vi.fn(),
  };
  const driven = withPlateState(plate, surfaces);

  driven.beginSpeech(undefined, undefined);
  expect(plate.setLive.mock.calls).toEqual([[true]]);
  expect(surfaces.beginSpeech).toHaveBeenCalledWith(undefined, undefined);
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
