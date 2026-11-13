/** thread-reaction.test.ts — a Thread reaction on a chip tap, the waiting count, or a long wait: line, window, seat, expression, and the held turns fired after. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScreenRect, Thread, ThreadsSnapshot, WindowRect } from "../../contract";
import { createThreadReaction, type ThreadReactionDeps } from "./thread-reaction";

const SLOT: ScreenRect = { x: 10, y: 20, width: 30, height: 30 };
const THREADS: WindowRect = {
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  name: "Threads",
  ownerName: "YUI",
  pid: 1,
  windowNumber: 42,
  threadsWindow: true,
};
const OVER: WindowRect = {
  ...THREADS,
  x: 450,
  name: "Doc",
  ownerName: "TextEdit",
  pid: 2,
  windowNumber: 7,
  threadsWindow: false,
};
const BESIDE: WindowRect = { ...OVER, x: 600 };

type Executor = NonNullable<ReturnType<ThreadReactionDeps["getExecutor"]>>;

const waiting = (id: string, updated_at = 1): Thread => ({
  id,
  source: "codex",
  title: "Build",
  state: "input-required",
  entries: [],
  created_at: 1,
  updated_at,
  entry_count: 0,
});
const inState = (id: string, state: Thread["state"]): Thread => ({ ...waiting(id), state });
const snap = (threads: Thread[]): ThreadsSnapshot => ({ revision: 1, threads });

function setup() {
  const order: string[] = [];
  const turns: string[] = [];
  let snapshot = snap([]);
  const snapshotListeners = new Set<(s: ThreadsSnapshot) => void>();
  let enabled = true;
  const enabledListeners = new Set<(s: { enabled: boolean }) => void>();
  let thresholds = { count: 3, wait_min: 10 };
  const thresholdsListeners = new Set<(s: { count: number; wait_min: number }) => void>();
  let present = true;
  const tapListeners = new Set<() => void>();
  const shownListeners = new Set<(shown: boolean) => void>();
  const state = {
    windowOpen: false,
    windows: [] as WindowRect[],
    seat: null as { windowNumber: number } | null,
    pipelineBusy: false,
    speechOwed: false,
    executorBusy: false,
    busyAfterFire: false,
  };
  const command = vi.fn<Executor["command"]>(async () => {
    order.push("sit");
    return { ok: true };
  });
  const presentFn = vi.fn<ThreadReactionDeps["threadsWindow"]["present"]>(async (_chip, opts) => {
    order.push(`present:${opts?.thread ?? "-"}`);
    return "presented";
  });
  const speak = vi.fn<ThreadReactionDeps["speak"]>(async (text) => {
    order.push(`line:${text}`);
    return "spoken";
  });
  const land = vi.fn<ThreadReactionDeps["land"]>(async () => {});
  const deps: ThreadReactionDeps = {
    threads: {
      snapshot: () => snapshot,
      subscribe: (cb) => {
        snapshotListeners.add(cb);
        return () => snapshotListeners.delete(cb);
      },
    },
    enabled: {
      get: () => ({ enabled }),
      subscribe: (cb) => {
        enabledListeners.add(cb);
        return () => enabledListeners.delete(cb);
      },
    },
    thresholds: {
      get: () => thresholds,
      subscribe: (cb) => {
        thresholdsListeners.add(cb);
        return () => thresholdsListeners.delete(cb);
      },
    },
    isPresent: () => present,
    chipTaps: (cb) => {
      tapListeners.add(cb);
      return () => tapListeners.delete(cb);
    },
    isPipelineBusy: () => state.pipelineBusy,
    hasOutstandingSpeech: () => state.speechOwed,
    getExecutor: () => ({ isBusy: () => state.executorBusy, command }),
    armedSit: () => state.seat,
    threadsWindow: {
      isOpen: () => state.windowOpen,
      present: presentFn,
      onShown: (cb) => {
        shownListeners.add(cb);
        return () => shownListeners.delete(cb);
      },
    },
    slotRect: () => SLOT,
    listWindows: async () => state.windows,
    speak,
    lines: () => ({ threads_open: ["Let me open Threads."], threads_raise: ["Here, up front."] }),
    setEmotion: (signal) => order.push(`emotion:${signal.id}`),
    easeEmotionToNeutral: () => order.push("neutral"),
    land,
    holdMs: () => 4000,
    turn: {
      hold: (id) => turns.push(`hold:${id}`),
      fire: (ids) => {
        for (const id of ids) turns.push(`fire:${id}`);
        // The dispatcher takes a pushed turn up later, not within the firing tick.
        if (state.busyAfterFire)
          setTimeout(() => {
            state.pipelineBusy = true;
          }, 0);
      },
      release: (id) => turns.push(`release:${id}`),
    },
  };
  const reaction = createThreadReaction(deps);
  return {
    order,
    turns,
    state,
    command,
    present: presentFn,
    speak,
    land,
    reaction,
    push(threads: Thread[]) {
      snapshot = snap(threads);
      for (const cb of snapshotListeners) cb(snapshot);
    },
    setEnabled(next: boolean) {
      enabled = next;
      for (const cb of enabledListeners) cb({ enabled: next });
    },
    setThresholds(next: Partial<{ count: number; wait_min: number }>) {
      thresholds = { ...thresholds, ...next };
      for (const cb of thresholdsListeners) cb(thresholds);
    },
    setPresent(next: boolean) {
      present = next;
    },
    tap() {
      for (const cb of tapListeners) cb();
    },
    closeWindow() {
      for (const cb of shownListeners) cb(false);
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("count reach with the window closed: speaks the open line, opens the window on the newest counted Thread, sits, lands, shows the expression, then reverts it", async () => {
  const h = setup();
  h.land.mockImplementation(async () => {
    h.order.push("land");
  });
  h.setThresholds({ count: 2 });
  h.push([waiting("t1"), waiting("t2", 2)]);
  await flush();
  expect(h.order).toEqual([
    "line:Let me open Threads.",
    "present:t2",
    "sit",
    "land",
    "emotion:curious",
  ]);
  expect(h.present).toHaveBeenCalledWith(SLOT, { thread: "t2" });
  expect(h.command).toHaveBeenCalledWith({ action: "sit_on_window", app: "YUI" });
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.order.at(-1)).toBe("neutral");
});

it("a Thread entering input-required, completed or failed alone speaks nothing, presents nothing, sits nowhere and fires no turn", async () => {
  const h = setup();
  h.push([waiting("t1")]);
  await flush();
  expect(h.order).toEqual([]);
  h.push([inState("t1", "completed")]);
  await flush();
  expect(h.order).toEqual([]);
  h.push([inState("t1", "failed")]);
  await flush();
  expect(h.order).toEqual([]);
  expect(h.present).not.toHaveBeenCalled();
  expect(h.turns).toEqual(["hold:t1"]);
});

it("a tap speaks no line and presents nothing; she sits once the window is open and the counted ids fire as one turn", async () => {
  const h = setup();
  h.state.windows = [THREADS];
  h.push([waiting("t1"), waiting("t2", 2)]);
  h.tap();
  await flush();
  expect(h.speak).not.toHaveBeenCalled();
  expect(h.present).not.toHaveBeenCalled();
  expect(h.order).toEqual(["sit", "emotion:curious"]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2", "fire:t1", "fire:t2"]);
});

it("a count reach fires the held ids after the closed-window steps", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.push([waiting("t1"), waiting("t2", 2)]);
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads.", "present:t2", "sit", "emotion:curious"]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2", "fire:t1", "fire:t2"]);
});

it("a wait reach presents its own Thread", async () => {
  const h = setup();
  h.push([waiting("t1")]);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(h.order).toEqual(["line:Let me open Threads.", "present:t1", "sit", "emotion:curious"]);
  expect(h.present).toHaveBeenCalledWith(SLOT, { thread: "t1" });
});

it("away: a count reach waits for her return, a tap does not", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.setPresent(false);
  h.push([waiting("t1"), waiting("t2", 2)]);
  await vi.advanceTimersByTimeAsync(3000);
  expect(h.order).toEqual([]);

  h.setPresent(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.order).toEqual(["line:Let me open Threads.", "present:t2", "sit", "emotion:curious"]);

  h.setPresent(false);
  h.state.windows = [THREADS];
  h.tap();
  await flush();
  expect(h.order.at(-2)).toBe("sit");
  expect(h.order.at(-1)).toBe("emotion:curious");
});

it("every Thread in the snapshot is held, a Thread gone from it is released, and the switch off releases all", () => {
  const h = setup();
  h.push([inState("t1", "working"), inState("t2", "failed")]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2"]);

  h.push([inState("t1", "working")]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2", "release:t2"]);

  h.setEnabled(false);
  expect(h.turns).toEqual(["hold:t1", "hold:t2", "release:t2", "release:t1"]);
});

it("a tap whose window is not listed yet retries and sits once it is listed; the window closing cancels a pending tap", async () => {
  const h = setup();
  h.push([waiting("t1")]);
  h.tap();
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.command).not.toHaveBeenCalled();

  h.state.windows = [THREADS];
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.command).toHaveBeenCalledTimes(1);
  expect(h.order).toEqual(["sit", "emotion:curious"]);

  h.state.seat = { windowNumber: 42 };
  h.tap();
  h.closeWindow();
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.command).toHaveBeenCalledTimes(1);
  expect(h.order).toEqual(["sit", "emotion:curious"]);
});

it("a pending wait whose Thread stops being counted is dropped", async () => {
  const h = setup();
  h.push([waiting("t1")]);
  h.state.pipelineBusy = true;
  await vi.advanceTimersByTimeAsync(600_000);
  expect(h.order).toEqual([]);

  h.push([inState("t1", "working")]);
  h.state.pipelineBusy = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.order).toEqual([]);
  expect(h.turns).toEqual(["hold:t1"]);

  h.push([]);
  expect(h.turns).toEqual(["hold:t1", "release:t1"]);
});

it.each([
  [
    "covered by a window in front",
    [OVER, THREADS],
    null,
    ["line:Here, up front.", "present:-", "sit", "emotion:curious"],
    [[]],
  ],
  [
    "open but not listed",
    [],
    null,
    ["line:Here, up front.", "present:-", "sit", "emotion:curious"],
    [[]],
  ],
  ["open and visible", [BESIDE, THREADS], null, ["sit", "emotion:curious"], []],
  ["open with her seated on it", [THREADS], { windowNumber: 42 }, ["emotion:curious"], []],
] as const)("%s: a count reach runs only the steps the window state needs", async (_name, windows, seat, expected, presentCalls) => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.state.windowOpen = true;
  h.state.windows = [...windows];
  h.state.seat = seat;
  h.push([waiting("t1"), waiting("t2")]);
  await flush();
  // One reaction per count edge, not one per Thread: the retry brings no second run.
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.order).toEqual(expected);
  expect(h.present.mock.calls).toEqual(presentCalls);
});

it("a cut line stops the run", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.speak.mockImplementation(async (text) => {
    h.order.push(`line:${text}`);
    return "cut";
  });
  h.push([waiting("t1"), waiting("t2")]);
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads."]);
});

it("a window that closes instead of presenting stops the run", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.present.mockImplementation(async () => {
    h.order.push("present:closed");
    return "closed";
  });
  h.push([waiting("t1"), waiting("t2")]);
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads.", "present:closed"]);
});

it("a refused sit drops the reaction with no expression and no retry", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.command.mockImplementation(async () => {
    h.order.push("sit");
    return { ok: false, reason: "busy" };
  });
  h.push([waiting("t1"), waiting("t2")]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.order).toEqual(["sit"]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2"]);
});

it("skips the expression revert while speech is owed", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.push([waiting("t1"), waiting("t2")]);
  await flush();
  h.state.speechOwed = true;
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.order).toEqual(["sit", "emotion:curious"]);
});

it("the switch turned off mid-run halts it and releases the held turns", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.speak.mockImplementation((text) => {
    h.order.push(`line:${text}`);
    return new Promise(() => {});
  });
  h.push([waiting("t1"), waiting("t2")]);
  await flush();
  h.setEnabled(false);
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads."]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2", "release:t1", "release:t2"]);
});

it("dispose clears the timers", async () => {
  const h = setup();
  h.setThresholds({ count: 2 });
  h.state.pipelineBusy = true;
  h.push([waiting("t1"), waiting("t2")]);
  await flush();
  // The retry and the wait timer.
  expect(vi.getTimerCount()).toBe(2);
  h.reaction.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
