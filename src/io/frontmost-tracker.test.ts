import { describe, expect, it } from "vitest";
import { createFrontmostTracker } from "./frontmost-tracker";
import type { OsEventPayload } from "./tauri-listen";

function tick(
  ts: number,
  frontmost?: { app?: string | null; title?: string | null },
): OsEventPayload {
  return {
    event_name: "os_tick",
    ts,
    data: {
      os_idle_ms: 0,
      ...(frontmost?.app !== undefined ? { frontmost_app: frontmost.app } : {}),
      ...(frontmost?.title !== undefined ? { frontmost_title: frontmost.title } : {}),
    },
  };
}

describe("frontmost tracker", () => {
  it("returns undefined before any sample arrives", () => {
    const tracker = createFrontmostTracker();
    expect(tracker.get()).toBeUndefined();
  });

  it("captures the first sample with since = tick ts", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "contract.md" }));
    expect(tracker.get()).toEqual({ app: "Cursor", window_title: "contract.md", since: 1_000 });
  });

  it("keeps since stable across unchanged polls", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "contract.md" }));
    tracker.onTick(tick(6_000, { app: "Cursor", title: "contract.md" }));
    expect(tracker.get()?.since).toBe(1_000);
  });

  it("advances since on an app change", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "contract.md" }));
    tracker.onTick(tick(6_000, { app: "Chrome", title: "contract.md" }));
    expect(tracker.get()).toEqual({ app: "Chrome", window_title: "contract.md", since: 6_000 });
  });

  it("advances since on a title change within the same app", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000, { app: "Cursor", title: "b.ts" }));
    expect(tracker.get()?.since).toBe(6_000);
  });

  it("omits absent fields rather than carrying null", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: null }));
    expect(tracker.get()).toEqual({ app: "Cursor", since: 1_000 });
  });

  it("clears the sample when a tick carries no frontmost fields", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000));
    expect(tracker.get()).toBeUndefined();
  });

  it("restores the original since when the same context returns after a transient clear", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000));
    tracker.onTick(tick(11_000, { app: "Cursor", title: "a.ts" }));
    expect(tracker.get()).toEqual({ app: "Cursor", window_title: "a.ts", since: 1_000 });
  });

  it("stamps a fresh since when a different context follows a clear", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000));
    tracker.onTick(tick(11_000, { app: "Chrome", title: "docs" }));
    expect(tracker.get()).toEqual({ app: "Chrome", window_title: "docs", since: 11_000 });
  });

  it("restores the original since when the same context returns within the grace window", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000));
    tracker.onTick(tick(6_000 + 4 * 60_000, { app: "Cursor", title: "a.ts" }));
    expect(tracker.get()).toEqual({ app: "Cursor", window_title: "a.ts", since: 1_000 });
  });

  it("stamps a fresh since when the same context returns after the grace window elapses", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000));
    const returnTs = 6_000 + 6 * 60_000;
    tracker.onTick(tick(returnTs, { app: "Cursor", title: "a.ts" }));
    expect(tracker.get()).toEqual({ app: "Cursor", window_title: "a.ts", since: returnTs });
  });

  it("stamps a fresh since when A returns after B replaced it across two clears", () => {
    const tracker = createFrontmostTracker();
    tracker.onTick(tick(1_000, { app: "Cursor", title: "a.ts" }));
    tracker.onTick(tick(6_000));
    tracker.onTick(tick(11_000, { app: "Chrome", title: "docs" }));
    tracker.onTick(tick(16_000));
    tracker.onTick(tick(21_000, { app: "Cursor", title: "a.ts" }));
    expect(tracker.get()).toEqual({ app: "Cursor", window_title: "a.ts", since: 21_000 });
  });
});
