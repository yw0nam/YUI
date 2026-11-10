/** landing.test.ts — her landing bounce on the canvas after a sit: a drop onto the seat with a squash about it. */

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

it("squashes her about the seat", async () => {
  const c = canvas();

  await createLanding(c.el, () => ({ x: 120, y: 340 }))();

  expect(c.origins).toEqual(["120px 340px"]);
});

it("does not animate without a seat", async () => {
  const c = canvas();

  await createLanding(c.el, () => null)();

  expect(c.animate).not.toHaveBeenCalled();
});

it("a second landing cancels the one still running", () => {
  const c = canvas(new Promise(() => {}));
  const land = createLanding(c.el, () => ({ x: 120, y: 340 }));

  void land();
  void land();

  expect(c.cancels.map((cancel) => cancel.mock.calls.length)).toEqual([1, 0]);
});
