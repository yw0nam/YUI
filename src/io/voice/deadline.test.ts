/**
 * deadline.test.ts — per-request deadline signal.
 *
 * Pins createDeadlineSignal's timer contract: pending before the deadline,
 * TimeoutError abortion at the deadline, and cancellation via clear().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeadlineSignal, untilAborted } from "./deadline";

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

describe("untilAborted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a settled promise through while the signal never aborts", async () => {
    const { signal } = createDeadlineSignal(1000, "x");

    await expect(untilAborted(Promise.resolve("value"), signal)).resolves.toBe("value");
  });

  it("rejects a never-settling promise with signal.reason when the deadline fires", async () => {
    const { signal } = createDeadlineSignal(1000, "x");
    const pending = untilAborted(new Promise<never>(() => {}), signal);

    vi.advanceTimersByTime(1000);

    await expect(pending).rejects.toBe(signal.reason);
  });

  it("rejects at once with the reason of an already-aborted signal and swallows the late rejection", async () => {
    const signal = AbortSignal.abort(new Error("x"));

    await expect(untilAborted(Promise.reject(new Error("late")), signal)).rejects.toBe(
      signal.reason,
    );
  });
});
