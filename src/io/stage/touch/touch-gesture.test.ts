import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTouchGesture, type TouchGesture, type TouchGestureCallbacks } from "./touch-gesture";

function makeCallbacks() {
  return {
    onOrbit: vi.fn<TouchGestureCallbacks["onOrbit"]>(),
    onPinchStart: vi.fn<TouchGestureCallbacks["onPinchStart"]>(),
    onPinch: vi.fn<TouchGestureCallbacks["onPinch"]>(),
    onTap: vi.fn<TouchGestureCallbacks["onTap"]>(),
  };
}

describe("createTouchGesture", () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let g: TouchGesture;

  beforeEach(() => {
    cb = makeCallbacks();
    g = createTouchGesture(cb);
  });

  /** Two fingers pinch out and back: one orbit, then ratios 2 and 1.5. */
  function pinchAfterOrbit(): void {
    g.down(1, { x: 0, y: 0 }, 0);
    g.move(1, { x: 10, y: 0 });
    g.down(2, { x: 110, y: 0 }, 50);
    g.move(2, { x: 210, y: 0 });
    g.move(1, { x: 60, y: 0 });
  }

  it("taps on a short still press", () => {
    g.down(1, { x: 10, y: 10 }, 0);
    g.up(1, { x: 12, y: 11 }, 200);
    expect(cb.onTap).toHaveBeenCalledOnce();
    expect(cb.onTap).toHaveBeenCalledWith({ x: 12, y: 11 });
    expect(cb.onOrbit).not.toHaveBeenCalled();
  });

  it("orbits per move once the travel passes the threshold and never taps", () => {
    g.down(1, { x: 0, y: 0 }, 0);
    g.move(1, { x: 10, y: 0 });
    expect(cb.onOrbit).toHaveBeenLastCalledWith({ dx: 10, dy: 0 });
    g.move(1, { x: 15, y: 5 });
    expect(cb.onOrbit).toHaveBeenLastCalledWith({ dx: 5, dy: 5 });
    g.up(1, { x: 15, y: 5 }, 100);
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it("does not tap on a press held past the tap duration; the boundary taps", () => {
    g.down(1, { x: 0, y: 0 }, 0);
    g.up(1, { x: 0, y: 0 }, 401);
    expect(cb.onTap).not.toHaveBeenCalled();
    g.down(1, { x: 0, y: 0 }, 1000);
    g.up(1, { x: 0, y: 0 }, 1400);
    expect(cb.onTap).toHaveBeenCalledOnce();
  });

  it("starts a pinch from the landing spread of the second finger and stops the orbit", () => {
    pinchAfterOrbit();
    expect(cb.onPinchStart).toHaveBeenCalledOnce();
    expect(cb.onPinch.mock.calls).toEqual([[2], [1.5]]);
    expect(cb.onOrbit).toHaveBeenCalledOnce();
    g.up(1, { x: 60, y: 0 }, 300);
    g.up(2, { x: 210, y: 0 }, 310);
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it("re-arms the orbit from the remaining finger after a pinch and never taps", () => {
    pinchAfterOrbit();
    g.up(2, { x: 210, y: 0 }, 300);
    g.move(1, { x: 70, y: 0 });
    expect(cb.onOrbit).toHaveBeenLastCalledWith({ dx: 10, dy: 0 });
    g.up(1, { x: 70, y: 0 }, 350);
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it("suspends on a third finger until one finger is left", () => {
    g.down(1, { x: 0, y: 0 }, 0);
    g.down(2, { x: 100, y: 0 }, 1);
    g.down(3, { x: 50, y: 50 }, 2);
    g.move(1, { x: 10, y: 0 });
    g.move(2, { x: 200, y: 0 });
    g.up(3, { x: 50, y: 50 }, 3);
    g.move(2, { x: 220, y: 0 });
    expect(cb.onOrbit).not.toHaveBeenCalled();
    expect(cb.onPinch).not.toHaveBeenCalled();
    g.up(2, { x: 220, y: 0 }, 4);
    g.move(1, { x: 20, y: 0 });
    expect(cb.onOrbit).toHaveBeenCalledOnce();
    expect(cb.onOrbit).toHaveBeenCalledWith({ dx: 10, dy: 0 });
    g.up(1, { x: 20, y: 0 }, 5);
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it("ends the press on cancel without a tap, and a fresh press taps", () => {
    g.down(1, { x: 0, y: 0 }, 0);
    g.cancel(1);
    expect(cb.onTap).not.toHaveBeenCalled();
    g.down(1, { x: 0, y: 0 }, 10);
    g.up(1, { x: 0, y: 0 }, 20);
    expect(cb.onTap).toHaveBeenCalledOnce();
  });

  it("ignores ids it does not track", () => {
    g.move(9, { x: 50, y: 50 });
    g.up(9, { x: 50, y: 50 }, 5);
    g.cancel(9);
    expect(cb.onOrbit).not.toHaveBeenCalled();
    expect(cb.onTap).not.toHaveBeenCalled();
    g.down(1, { x: 0, y: 0 }, 10);
    g.move(9, { x: 50, y: 50 });
    g.up(9, { x: 50, y: 50 }, 15);
    g.cancel(9);
    g.up(1, { x: 0, y: 0 }, 20);
    expect(cb.onTap).toHaveBeenCalledOnce();
  });

  it("arms a pinch from a degenerate spread on the first measurable move", () => {
    g.down(1, { x: 0, y: 0 }, 0);
    g.down(2, { x: 0, y: 0 }, 1);
    g.move(2, { x: 0.5, y: 0 });
    expect(cb.onPinchStart).not.toHaveBeenCalled();
    g.move(2, { x: 10, y: 0 });
    expect(cb.onPinchStart).toHaveBeenCalledOnce();
    expect(cb.onPinch).not.toHaveBeenCalled();
    g.move(2, { x: 20, y: 0 });
    expect(cb.onPinch).toHaveBeenCalledWith(2);
  });

  it("forgets every finger on reset", () => {
    g.down(1, { x: 0, y: 0 }, 0);
    g.reset();
    g.up(1, { x: 0, y: 0 }, 10);
    expect(cb.onTap).not.toHaveBeenCalled();
    expect(cb.onOrbit).not.toHaveBeenCalled();
  });
});
