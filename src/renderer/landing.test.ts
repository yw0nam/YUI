/** landing.test.ts — her landing bounce on the canvas, and her vanishing from and appearing on it. */

import { expect, it, vi } from "vitest";
import { createLanding } from "./landing";

function canvas(finished: Promise<void> = Promise.resolve()) {
  const style = { transformOrigin: "" };
  const origins: string[] = [];
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const animate = vi.fn((_frames: Keyframe[], _opts: KeyframeAnimationOptions) => {
    origins.push(style.transformOrigin);
    const cancel = vi.fn();
    cancels.push(cancel);
    return { finished, cancel };
  });
  return { el: { style, animate } as unknown as HTMLElement, animate, origins, cancels };
}

it.each([
  ["the seat with no origin", undefined, "120px 340px"],
  ["the origin it is given", { x: 30, y: 500 }, "30px 500px"],
])("squashes her about %s", async (_, origin, expected) => {
  const c = canvas();

  await createLanding(c.el, () => ({ x: 120, y: 340 })).land(origin);

  expect(c.origins).toEqual([expected]);
});

it("does not animate without a seat", async () => {
  const c = canvas();

  await createLanding(c.el, () => null).land();

  expect(c.animate).not.toHaveBeenCalled();
});

it.each([
  ["with a seat", { x: 80, y: 300 }, [1, 0], "80px 300px"],
  ["without a seat", null, [1], ""],
] as const)("a second landing %s cancels the one still running", (_name, seat, cancels, origin) => {
  const c = canvas(new Promise(() => {}));
  const seats = [{ x: 120, y: 340 }, seat];
  const { land } = createLanding(c.el, () => seats.shift() ?? null);

  void land();
  void land();

  expect(c.cancels.map((cancel) => cancel.mock.calls.length)).toEqual(cancels);
  expect(c.el.style.transformOrigin).toBe(origin);
});

it("a landing after a vanish cancels the vanish", () => {
  const c = canvas(new Promise(() => {}));
  const landing = createLanding(c.el, () => ({ x: 120, y: 340 }));

  void landing.vanish();
  void landing.land();

  expect(c.cancels.map((cancel) => cancel.mock.calls.length)).toEqual([1, 0]);
});

it("appears by opacity alone", async () => {
  const c = canvas();

  await createLanding(c.el, () => ({ x: 120, y: 340 })).appear();

  expect(c.animate.mock.calls.map(([frames]) => frames)).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
  ]);
  expect(c.origins).toEqual([""]);
});
