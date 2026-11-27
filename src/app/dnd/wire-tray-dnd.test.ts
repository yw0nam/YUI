import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger";
import type { RestChoice, RestState } from "../../settings/rest/rest-choices";
import { wireTrayDnd } from "./wire-tray-dnd";

const RESTING: RestState = { kind: "rest", choice: "hour", startedAt: 1, endsAt: 3_600_001 };

function setup(initial: RestState | null) {
  let current = initial;
  const listeners = new Set<() => void>();
  const set = (next: RestState | null) => {
    current = next;
    for (const cb of listeners) cb();
  };
  const rest = {
    rest: () => current,
    subscribeRest: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const restSettings = {
    start: vi.fn((choice: RestChoice) => set({ kind: "rest", choice, startedAt: 2 })),
    end: vi.fn(() => set(null)),
  };
  let trayHandler: ((event: { payload: boolean }) => void) | undefined;
  const win = {
    listen: vi.fn(async (_event: "tray-dnd", handler: (event: { payload: boolean }) => void) => {
      trayHandler = handler;
      return () => {};
    }),
  };
  const setTray = vi.fn(async (_on: boolean) => {});
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  wireTrayDnd({ rest, restSettings, win, setTray, log } as never);
  return {
    set,
    restSettings,
    setTray,
    log,
    click: (payload: boolean) => trayHandler?.({ payload }),
    expire: () => {
      current = null;
    },
  };
}

describe("wireTrayDnd", () => {
  it("checks the tray while a Rest or a Focus runs, not in a quiet span, sending only a change of the check", () => {
    const { set, setTray } = setup(RESTING);

    set({ kind: "focus", choice: "focus_25", startedAt: 1, endsAt: 1_500_001 });
    set({ kind: "focus", choice: "focus_25", startedAt: 1, endsAt: 1_500_001 });
    set({ kind: "quiet", endsAt: 5 });
    set(null);

    expect(setTray.mock.calls).toEqual([[true], [false]]);
  });

  it("ends a running Rest on a click and sends the check again", async () => {
    const { restSettings, setTray, log, click } = setup(RESTING);
    await Promise.resolve();

    click(false);

    expect([restSettings.end.mock.calls.length, restSettings.start.mock.calls]).toEqual([1, []]);
    expect(setTray.mock.calls.at(-1)).toEqual([false]);
    expect(log.info).toHaveBeenCalledWith("rest_set", { choice: "end", via: "tray" });
  });

  it("starts Until I turn it off on a click that lands after the Rest ended", async () => {
    const { restSettings, setTray, click, expire } = setup(RESTING);
    await Promise.resolve();
    expire();

    click(false);

    expect([restSettings.start.mock.calls, restSettings.end.mock.calls.length]).toEqual([
      [["until_off"]],
      0,
    ]);
    expect(setTray.mock.calls.at(-1)).toEqual([true]);
  });
});
