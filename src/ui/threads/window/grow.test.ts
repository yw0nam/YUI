// @vitest-environment jsdom
/** grow.test.ts — the Threads window's grow out of the chip, with the jelly an automatic open adds. */

import { expect, it, vi } from "vitest";
import { growOpen } from "./grow";

const CHIP = { x: 700, y: 640, width: 150, height: 32 };

function parts() {
  const root = document.createElement("div");
  const panel = document.createElement("section");
  const content = document.createElement("div");
  panel.getBoundingClientRect = () =>
    ({
      x: 8,
      y: 8,
      left: 8,
      top: 8,
      right: 888,
      bottom: 688,
      width: 880,
      height: 680,
    }) as DOMRect;
  const calls: Keyframe[][] = [];
  for (const el of [panel, content])
    el.animate = vi.fn((frames: Keyframe[]) => {
      calls.push(frames);
      return { finished: Promise.resolve() } as unknown as Animation;
    }) as never;
  return { parts: { root, panel, content }, calls };
}

/** The `scale(x, y)` factors of each keyframe that carries one. */
const scales = (calls: Keyframe[][]): [number, number][] =>
  calls.flat().flatMap((frame) => {
    const m = /scale\(([^,]+),\s*([^)]+)\)/.exec(String(frame.transform ?? ""));
    return m ? [[Number(m[1]), Number(m[2])] as [number, number]] : [];
  });

it("with jelly, the panel stretches at most the 8px margin wide and tall", async () => {
  const { parts: p, calls } = parts();

  await growOpen(p, CHIP, { jelly: true });

  const factors = scales(calls);
  expect(Math.max(...factors.map(([x]) => x))).toBeCloseTo(1 + 16 / 880, 6);
  expect(Math.max(...factors.map(([, y]) => y))).toBeCloseTo(1 + 8 / 680, 6);
});

it("without jelly, no animation carries a transform", async () => {
  const { parts: p, calls } = parts();

  await growOpen(p, CHIP);

  expect(calls.flat().filter((frame) => "transform" in frame)).toEqual([]);
});
