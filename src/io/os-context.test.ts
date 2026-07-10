/**
 * os-context.test.ts — OS context snapshot holder.
 *
 * Locks:
 *  - active_app_changed payload updates activeApp / activeWindowTitle.
 *  - non-app events (os_idle_tick) leave the app/title snapshot unchanged.
 *  - null/empty active_app_name does not overwrite with a bogus value.
 *  - before start() / without a listen fn: get() is {} and start() no-ops (no throw).
 *  - stop() calls the stored unlisten fn.
 *  - active_app_changed appends to the recentApps buffer; drainRecentApps returns it in
 *    order and empties it; maxRecentApps caps the buffer, dropping the oldest entries.
 *  - peekRecentApps returns a copy without emptying the buffer.
 *  - drainRecentApps(peeked) removes only the snapshotted entries; a switch that lands after
 *    the peek survives and carries over to the next turn.
 *  - drainRecentApps / peekRecentApps re-trim to the *live* cap on every call (not just on
 *    push), so lowering the cap without a new app switch still yields a capped read.
 *  - without maxRecentApps injected, the buffer is uncapped (no fallback default).
 */

import { describe, expect, it, vi } from "vitest";
import { createOsContext, type OsEventPayload } from "./os-context";

type Handler = (e: { payload: OsEventPayload }) => void;

/** Fake `listen` capturing the subscribed handler so tests can emit payloads. */
function fakeListen() {
  let handler: Handler | undefined;
  const unlisten = vi.fn();
  const listen = vi.fn(async (_event: string, h: Handler) => {
    handler = h;
    return unlisten;
  });
  return {
    listen,
    unlisten,
    emit(payload: OsEventPayload) {
      handler?.({ payload });
    },
  };
}

function appChanged(
  active_app_name: string | null | undefined,
  active_window_title: string | null | undefined,
): OsEventPayload {
  return {
    event_name: "active_app_changed",
    ts: 1_717_000_000_000,
    data: { active_app_name, active_window_title },
  };
}

function fullscreen(entered: boolean): OsEventPayload {
  return {
    event_name: entered ? "fullscreen_entered" : "fullscreen_exited",
    ts: 1_717_000_000_001,
    data: { is_fullscreen: entered },
  };
}

describe("os-context — snapshot from os_event", () => {
  it("active_app_changed updates activeApp + activeWindowTitle", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(appChanged("Visual Studio Code", "main.ts"));
    expect(os.get()).toEqual({ activeApp: "Visual Studio Code", activeWindowTitle: "main.ts" });
  });

  it("os_idle_tick leaves the app/title snapshot unchanged and does not set isFullscreen", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(appChanged("Visual Studio Code", "main.ts"));
    f.emit({ event_name: "os_idle_tick", ts: 1, data: { os_idle_ms: 5000 } });
    expect(os.get()).toEqual({ activeApp: "Visual Studio Code", activeWindowTitle: "main.ts" });
    expect(os.get().isFullscreen).toBeUndefined();
  });

  it("fullscreen_entered sets isFullscreen true", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(fullscreen(true));
    expect(os.get().isFullscreen).toBe(true);
  });

  it("fullscreen_exited sets isFullscreen false", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(fullscreen(true));
    f.emit(fullscreen(false));
    expect(os.get().isFullscreen).toBe(false);
  });

  it("fullscreen events leave the app/title snapshot unchanged", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(appChanged("Visual Studio Code", "main.ts"));
    f.emit(fullscreen(true));
    expect(os.get().activeApp).toBe("Visual Studio Code");
    expect(os.get().activeWindowTitle).toBe("main.ts");
  });

  it("null/empty active_app_name does not overwrite with a bogus value", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(appChanged("Visual Studio Code", "main.ts"));
    f.emit(appChanged(null, null));
    expect(os.get().activeApp).toBe("Visual Studio Code");
    f.emit(appChanged("", null));
    expect(os.get().activeApp).toBe("Visual Studio Code");
  });

  it("new app without a readable title clears activeWindowTitle", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit(appChanged("Visual Studio Code", "main.ts"));
    f.emit(appChanged("Finder", null));
    expect(os.get()).toEqual({ activeApp: "Finder", activeWindowTitle: undefined });
  });

  it("before start() / without a listen fn, get() is {} and start() no-ops without throwing", async () => {
    const os = createOsContext();
    expect(os.get()).toEqual({});
    await expect(os.start()).resolves.toBeUndefined();
    expect(os.get()).toEqual({});
  });

  it("stop() calls the stored unlisten fn", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    os.stop();
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it("stop() before start() is safe (no throw)", () => {
    const os = createOsContext({ listen: fakeListen().listen });
    expect(() => os.stop()).not.toThrow();
  });
});

describe("os-context — recentApps buffer", () => {
  it("drainRecentApps returns injected app switches in order, then empties the buffer", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit({ event_name: "active_app_changed", ts: 100, data: { active_app_name: "A" } });
    f.emit({ event_name: "active_app_changed", ts: 200, data: { active_app_name: "B" } });
    f.emit({ event_name: "active_app_changed", ts: 300, data: { active_app_name: "C" } });

    expect(os.drainRecentApps()).toEqual([
      { name: "A", ts: 100 },
      { name: "B", ts: 200 },
      { name: "C", ts: 300 },
    ]);
    expect(os.drainRecentApps()).toEqual([]);
  });

  it("maxRecentApps caps the buffer, dropping the oldest entry", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen, maxRecentApps: () => 2 });
    await os.start();
    f.emit({ event_name: "active_app_changed", ts: 100, data: { active_app_name: "A" } });
    f.emit({ event_name: "active_app_changed", ts: 200, data: { active_app_name: "B" } });
    f.emit({ event_name: "active_app_changed", ts: 300, data: { active_app_name: "C" } });

    expect(os.drainRecentApps()).toEqual([
      { name: "B", ts: 200 },
      { name: "C", ts: 300 },
    ]);
  });

  it("without maxRecentApps injected, the buffer is uncapped (no fallback default)", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    for (let i = 0; i < 15; i++) {
      f.emit({
        event_name: "active_app_changed",
        ts: i,
        data: { active_app_name: `app-${i}` },
      });
    }
    expect(os.drainRecentApps()).toHaveLength(15);
  });

  it("peekRecentApps returns a copy of the buffer without emptying it", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit({ event_name: "active_app_changed", ts: 100, data: { active_app_name: "A" } });
    f.emit({ event_name: "active_app_changed", ts: 200, data: { active_app_name: "B" } });

    const expected = [
      { name: "A", ts: 100 },
      { name: "B", ts: 200 },
    ];
    expect(os.peekRecentApps()).toEqual(expected);
    // buffer untouched by peek — a second peek sees the same entries.
    expect(os.peekRecentApps()).toEqual(expected);
    // drain still sees everything peek saw.
    expect(os.drainRecentApps()).toEqual(expected);
    expect(os.drainRecentApps()).toEqual([]);
  });

  it("lowering the live cap after pushes trims stale entries on the next peek/drain", async () => {
    const f = fakeListen();
    let cap = 10;
    const os = createOsContext({ listen: f.listen, maxRecentApps: () => cap });
    await os.start();
    f.emit({ event_name: "active_app_changed", ts: 100, data: { active_app_name: "A" } });
    f.emit({ event_name: "active_app_changed", ts: 200, data: { active_app_name: "B" } });
    f.emit({ event_name: "active_app_changed", ts: 300, data: { active_app_name: "C" } });

    // cap lowered without any further app switch — write-time trim never saw this.
    cap = 2;
    const expected = [
      { name: "B", ts: 200 },
      { name: "C", ts: 300 },
    ];
    expect(os.peekRecentApps()).toEqual(expected);
    expect(os.drainRecentApps()).toEqual(expected);
  });

  it("drainRecentApps(peeked) removes only the snapshot; a switch after the peek survives", async () => {
    const f = fakeListen();
    const os = createOsContext({ listen: f.listen });
    await os.start();
    f.emit({ event_name: "active_app_changed", ts: 100, data: { active_app_name: "A" } });
    f.emit({ event_name: "active_app_changed", ts: 200, data: { active_app_name: "B" } });

    const peeked = os.peekRecentApps(); // snapshot [A, B] — what this turn sent
    // C switches in mid-request, after the peek.
    f.emit({ event_name: "active_app_changed", ts: 300, data: { active_app_name: "C" } });

    // drain removes only the peeked entries, returning them; C is not touched.
    expect(os.drainRecentApps(peeked)).toEqual([
      { name: "A", ts: 100 },
      { name: "B", ts: 200 },
    ]);
    // C carries over to the next turn instead of being lost.
    expect(os.drainRecentApps()).toEqual([{ name: "C", ts: 300 }]);
  });
});
