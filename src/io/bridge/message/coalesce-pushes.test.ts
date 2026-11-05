import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescingBridge } from "./coalesce-pushes";
import type { MessageBridge } from "./message-bridge";

describe("createCoalescingBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const bridge = {
      emitSurface: vi.fn(),
      onSurface: () => () => {},
      emitControl: vi.fn(),
      onControl: () => () => {},
      dispose: vi.fn(),
    } as unknown as MessageBridge;
    return { bridge, coalescing: createCoalescingBridge(bridge) };
  }

  it("sends one burst of deltas as a single push", () => {
    const { bridge, coalescing } = setup();
    for (const delta of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      coalescing.emitSurface({ op: "push", delta });
      vi.advanceTimersByTime(3);
    }
    expect(bridge.emitSurface).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);

    expect(vi.mocked(bridge.emitSurface).mock.calls).toEqual([
      [{ op: "push", delta: "abcdefghij" }],
    ]);
  });

  it("sends the held deltas before the op that follows them", () => {
    const { bridge, coalescing } = setup();
    coalescing.emitSurface({ op: "push", delta: "a" });
    expect(bridge.emitSurface).not.toHaveBeenCalled();

    coalescing.emitSurface({ op: "end" });

    expect(vi.mocked(bridge.emitSurface).mock.calls).toEqual([
      [{ op: "push", delta: "a" }],
      [{ op: "end" }],
    ]);
  });

  it("drops the pending timer when a flush sends the held deltas", () => {
    const { bridge, coalescing } = setup();
    coalescing.emitSurface({ op: "push", delta: "a" });
    coalescing.emitSurface({ op: "end" });
    vi.advanceTimersByTime(30);

    coalescing.emitSurface({ op: "push", delta: "b" });
    vi.advanceTimersByTime(39);

    expect(bridge.emitSurface).not.toHaveBeenCalledWith({ op: "push", delta: "b" });
    vi.advanceTimersByTime(1);
    expect(bridge.emitSurface).toHaveBeenLastCalledWith({ op: "push", delta: "b" });
  });
});
