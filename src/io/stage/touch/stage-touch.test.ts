import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachStageTouch } from "./stage-touch";
import type { TouchGesture } from "./touch-gesture";

type PointerInit = { pointerId: number; button?: number; clientX?: number; clientY?: number };

function makeSurface() {
  return Object.assign(new EventTarget(), {
    setPointerCapture: vi.fn<(id: number) => void>(),
    releasePointerCapture: vi.fn<(id: number) => void>(),
  });
}

function makeGesture() {
  return {
    down: vi.fn<TouchGesture["down"]>(),
    move: vi.fn<TouchGesture["move"]>(),
    up: vi.fn<TouchGesture["up"]>(),
    cancel: vi.fn<TouchGesture["cancel"]>(),
    reset: vi.fn<TouchGesture["reset"]>(),
  };
}

describe("attachStageTouch", () => {
  let el: ReturnType<typeof makeSurface>;
  let gesture: ReturnType<typeof makeGesture>;
  let detach: () => void;

  function fire(type: string, init: PointerInit): Event {
    const ev = Object.assign(new Event(type), { button: 0, clientX: 0, clientY: 0, ...init });
    el.dispatchEvent(ev);
    return ev;
  }

  beforeEach(() => {
    el = makeSurface();
    gesture = makeGesture();
    detach = attachStageTouch(el, gesture);
  });

  it("forwards id, client point and time stamp, and captures the pointer", () => {
    const down = fire("pointerdown", { pointerId: 7, clientX: 3, clientY: 4 });
    expect(gesture.down).toHaveBeenCalledWith(7, { x: 3, y: 4 }, down.timeStamp);
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);

    fire("pointermove", { pointerId: 7, clientX: 5, clientY: 6 });
    expect(gesture.move).toHaveBeenCalledWith(7, { x: 5, y: 6 });

    const up = fire("pointerup", { pointerId: 7, clientX: 5, clientY: 6 });
    expect(gesture.up).toHaveBeenCalledWith(7, { x: 5, y: 6 }, up.timeStamp);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(7);

    fire("pointerdown", { pointerId: 8, button: 2 });
    expect(gesture.down).toHaveBeenCalledOnce();

    el.setPointerCapture.mockImplementationOnce(() => {
      throw new Error("NotFoundError");
    });
    fire("pointerdown", { pointerId: 9, clientX: 1, clientY: 2 });
    expect(gesture.down).toHaveBeenLastCalledWith(9, { x: 1, y: 2 }, expect.any(Number));
  });

  it("cancels the pointer on pointercancel and lostpointercapture", () => {
    fire("pointercancel", { pointerId: 3 });
    fire("lostpointercapture", { pointerId: 4 });
    expect(gesture.cancel.mock.calls).toEqual([[3], [4]]);
  });

  it("removes the listeners and resets the gesture on detach", () => {
    detach();
    fire("pointerdown", { pointerId: 1 });
    expect(gesture.down).not.toHaveBeenCalled();
    expect(gesture.reset).toHaveBeenCalledOnce();
  });
});
