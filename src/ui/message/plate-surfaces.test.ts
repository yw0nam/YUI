// @vitest-environment jsdom
/**
 * plate-surfaces.test.ts — the Surfaces wrapper that mirrors speech and busy into the plate.
 */

import { describe, expect, it, vi } from "vitest";
import type { Surfaces } from "../surfaces/surfaces";
import { withPlate } from "./plate-surfaces";

function fakeSurfaces() {
  const calls: string[] = [];
  return {
    calls,
    surfaces: {
      beginSpeech: () => calls.push("beginSpeech"),
      pushSpeech: (delta: string) => calls.push(`pushSpeech:${delta}`),
      endSpeech: (opts?: { defer?: boolean }) => calls.push(`endSpeech:${opts?.defer ?? false}`),
      hideSpeech: () => calls.push("hideSpeech"),
      setBusy: (busy: boolean) => calls.push(`setBusy:${busy}`),
    } as unknown as Surfaces,
  };
}

describe("withPlate", () => {
  it("opens live with the speech, then closes it on end and hide", () => {
    const { surfaces } = fakeSurfaces();
    const plate = { setLive: vi.fn(), setBusy: vi.fn() };
    const wrapped = withPlate(surfaces, plate);

    wrapped.beginSpeech();
    wrapped.endSpeech();
    wrapped.hideSpeech();

    expect(plate.setLive.mock.calls).toEqual([[true], [false], [false]]);
  });

  it("mirrors busy into the plate", () => {
    const { surfaces } = fakeSurfaces();
    const plate = { setLive: vi.fn(), setBusy: vi.fn() };
    withPlate(surfaces, plate).setBusy(true);

    expect(plate.setBusy).toHaveBeenCalledWith(true);
  });

  it("forwards every other call untouched", () => {
    const { surfaces, calls } = fakeSurfaces();
    const plate = { setLive: vi.fn(), setBusy: vi.fn() };
    const wrapped = withPlate(surfaces, plate);

    wrapped.pushSpeech("hello");
    wrapped.endSpeech({ defer: true });

    expect(calls).toEqual(["pushSpeech:hello", "endSpeech:true"]);
    expect(plate.setLive).toHaveBeenCalledTimes(1);
  });
});
