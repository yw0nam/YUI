/**
 * The failed-turn notice the status pill carries: it holds long enough to reach its action and
 * clears itself, so an unattended pill does not keep taking OS clicks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnNotice } from "./turn-notice";

describe("createTurnNotice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds a notice with an action for 60 seconds", () => {
    const notice = createTurnNotice();
    const action = { label: "Change key", onClick: vi.fn() };
    notice.show({ message: "Auth failed", action });

    expect(notice.get()).toEqual({ message: "Auth failed", action });
    vi.advanceTimersByTime(59_999);
    expect(notice.get()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(notice.get()).toBeNull();
  });

  it("holds a notice with no action for 3 seconds", () => {
    const notice = createTurnNotice();
    notice.show({ message: "No response" });

    vi.advanceTimersByTime(2_999);
    expect(notice.get()).toEqual({ message: "No response" });
    vi.advanceTimersByTime(1);
    expect(notice.get()).toBeNull();
  });

  it("restarts the hold on a newer notice and tells its listeners each change", () => {
    const notice = createTurnNotice();
    const listener = vi.fn();
    notice.subscribe(listener);
    notice.show({ message: "first" });
    vi.advanceTimersByTime(2_000);
    notice.show({ message: "second" });
    vi.advanceTimersByTime(2_000);

    expect(notice.get()).toEqual({ message: "second" });
    vi.advanceTimersByTime(1_000);
    expect(notice.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("clears at once when a turn starts, and stops its timer on dispose", () => {
    const notice = createTurnNotice();
    notice.show({ message: "No response" });
    notice.clear();
    expect(notice.get()).toBeNull();

    const listener = vi.fn();
    notice.subscribe(listener);
    notice.show({ message: "again" });
    notice.dispose();
    vi.advanceTimersByTime(60_000);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
