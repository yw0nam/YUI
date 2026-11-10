// @vitest-environment jsdom
/** hop.test.ts — the Threads panel's hop when a Thread reaction raises the window: a lift inside the 8px margin. */

import { afterEach, expect, it, vi } from "vitest";
import { hop } from "./hop";

afterEach(() => {
  vi.unstubAllGlobals();
});

function panel() {
  const el = document.createElement("section");
  const animate = vi.fn((_frames: Keyframe[]) => ({
    finished: Promise.resolve(),
  }));
  el.animate = animate as never;
  return { el, animate };
}

it("lifts the panel at most 8px and never scales it", async () => {
  const { el, animate } = panel();

  await hop(el);

  const frames = animate.mock.calls.flatMap(([f]) => f).map((f) => String(f.transform ?? ""));
  const lifts = frames.flatMap((t) => {
    const m = /translateY\((-?[\d.]+)px\)/.exec(t);
    return m ? [Number(m[1])] : [];
  });
  expect(Math.min(...lifts)).toBe(-8);
  expect(frames.filter((t) => t.includes("scale"))).toEqual([]);
});

it("does not animate under reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { el, animate } = panel();

  await hop(el);

  expect(animate).not.toHaveBeenCalled();
});
