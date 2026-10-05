import { afterEach, describe, expect, it, vi } from "vitest";
import { withIdleWatchdog } from "./idle-watchdog";

describe("withIdleWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears its timer when the source stream throws", async () => {
    vi.useFakeTimers();
    const failing: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("boom")) }),
    };
    const watched = withIdleWatchdog(
      failing,
      { preSpeech: 1000, speechIdle: 500 },
      () => {},
      () => false,
    );

    await expect(watched.next()).rejects.toThrow("boom");

    expect(vi.getTimerCount()).toBe(0);
  });
});
