/**
 * deadline.test.ts — per-request deadline signal.
 *
 * Pins createDeadlineSignal's timer contract: pending before the deadline,
 * TimeoutError abortion at the deadline, and cancellation via clear().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeadlineSignal } from "./deadline";

describe("createDeadlineSignal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not aborted before the deadline elapses", () => {
    const { signal } = createDeadlineSignal(1000, "request timed out");

    vi.advanceTimersByTime(999);

    expect(signal.aborted).toBe(false);
  });

  it("aborts at the deadline with a TimeoutError", () => {
    const message = "request timed out";
    const { signal } = createDeadlineSignal(1000, message);

    vi.advanceTimersByTime(1000);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect(signal.reason.name).toBe("TimeoutError");
    expect(signal.reason.message).toBe(message);
  });

  it("clear cancels the deadline timer", () => {
    const { signal, clear } = createDeadlineSignal(1000, "request timed out");

    clear();
    vi.advanceTimersByTime(2000);

    expect(signal.aborted).toBe(false);
  });
});
