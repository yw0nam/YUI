import { describe, expect, it, vi } from "vitest";
import { createBedSceneHold } from "./bed-scene-hold";

describe("createBedSceneHold", () => {
  it("tells a listener when the scene takes the body, once per taking", () => {
    const hold = createBedSceneHold();
    const taken = vi.fn();
    hold.onTake(taken);

    hold.take();
    hold.take();
    expect(taken).toHaveBeenCalledOnce();

    hold.release();
    hold.take();
    expect(taken).toHaveBeenCalledTimes(2);
  });

  it("says nothing on a release, and stops telling a listener that unsubscribed", () => {
    const hold = createBedSceneHold();
    const taken = vi.fn();
    const off = hold.onTake(taken);

    hold.release();
    expect(taken).not.toHaveBeenCalled();

    off();
    hold.take();
    expect(taken).not.toHaveBeenCalled();
    expect(hold.isHeld()).toBe(true);
  });
});
