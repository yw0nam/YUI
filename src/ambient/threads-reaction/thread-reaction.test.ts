/** thread-reaction.test.ts — the main character's reaction to a Thread state change: line, window, seat, expression, once she is free. */

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

const snap = (...states: Thread["state"][]): ThreadsSnapshot => ({
  revision: 1,
  threads: states.map((state, at) => ({
    id: `t${at + 1}`,
    source: "codex",
    title: "Build",
    state,
    entries: [],
    created_at: 1,
    updated_at: 1,
    entry_count: 0,
  })),
});

function setup() {
  const order: string[] = [];
  const turns: string[] = [];
  let snapshot = snap("working");
  const snapshotListeners = new Set<(s: ThreadsSnapshot) => void>();
  let enabled = true;
  const enabledListeners = new Set<(s: { enabled: boolean }) => void>();
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
  const present = vi.fn<ThreadReactionDeps["threadsWindow"]["present"]>(async (_chip, opts) => {
    order.push(`present:${opts?.thread ?? "-"}`);
    return "presented";
  });
  const speak = vi.fn<ThreadReactionDeps["speak"]>(async (text) => {
    order.push(`line:${text}`);
    return "spoken";
  });
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
    isPipelineBusy: () => state.pipelineBusy,
    hasOutstandingSpeech: () => state.speechOwed,
    getExecutor: () => ({ isBusy: () => state.executorBusy, command }),
    armedSit: () => state.seat,
    threadsWindow: { isOpen: () => state.windowOpen, present },
    slotRect: () => SLOT,
    listWindows: async () => state.windows,
    speak,
    lines: () => ({ threads_open: ["Let me open Threads."], threads_raise: ["Here, up front."] }),
    setEmotion: (signal) => order.push(`emotion:${signal.id}`),
    easeEmotionToNeutral: () => order.push("neutral"),
    holdMs: () => 4000,
    turn: {
      hold: (id) => turns.push(`hold:${id}`),
      fire: (id) => {
        turns.push(`fire:${id}`);
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
    present,
    speak,
    reaction,
    push(...next: Thread["state"][]) {
      snapshot = snap(...next);
      for (const cb of snapshotListeners) cb(snapshot);
    },
    setEnabled(next: boolean) {
      enabled = next;
      for (const cb of enabledListeners) cb({ enabled });
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("closed: speaks the open line, opens the window on the Thread, sits, shows the expression, then reverts it", async () => {
  const h = setup();
  h.push("completed");
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads.", "present:t1", "sit", "emotion:happy"]);
  expect(h.present).toHaveBeenCalledWith(SLOT, { thread: "t1" });
  expect(h.command).toHaveBeenCalledWith({ action: "sit_on_window", app: "YUI" });
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.order.at(-1)).toBe("neutral");
});

it.each([
  [
    "covered by a window in front",
    [OVER, THREADS],
    null,
    "input-required",
    ["line:Here, up front.", "present:-", "sit", "emotion:curious"],
    [[]],
  ],
  [
    "open but not listed",
    [],
    null,
    "input-required",
    ["line:Here, up front.", "present:-", "sit", "emotion:curious"],
    [[]],
  ],
  ["open and visible", [BESIDE, THREADS], null, "failed", ["sit", "emotion:sad"], []],
  [
    "open with her seated on it",
    [THREADS],
    { windowNumber: 42 },
    "completed",
    ["emotion:happy"],
    [],
  ],
] as const)("%s: runs only the steps the window state needs", async (_name, windows, seat, state, expected, presentCalls) => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [...windows];
  h.state.seat = seat;
  h.push(state);
  await flush();
  expect(h.order).toEqual(expected);
  expect(h.present.mock.calls).toEqual(presentCalls);
});

it.each([
  "pipelineBusy",
  "speechOwed",
  "executorBusy",
] as const)("waits while %s and runs on the retry once she is free", async (busy) => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.state[busy] = true;
  h.push("completed");
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.order).toEqual([]);
  h.state[busy] = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.order).toEqual(["sit", "emotion:happy"]);
});

it("drops a held reaction whose Thread was answered before she was free", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.state.pipelineBusy = true;
  h.push("input-required");
  await flush();
  h.push("working");
  h.state.pipelineBusy = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.order).toEqual([]);
  h.push("completed");
  await flush();
  expect(h.order).toEqual(["sit", "emotion:happy"]);
});

it("stops a run whose Thread was answered during the line", async () => {
  let spoken: (result: "spoken") => void = () => {};
  const h = setup();
  h.speak.mockImplementation((text) => {
    h.order.push(`line:${text}`);
    return new Promise((resolve) => {
      spoken = resolve;
    });
  });
  h.push("input-required");
  await flush();
  h.push("working");
  spoken("spoken");
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads."]);
});

it("the switch turned off mid-run stops the run and releases it for the next reaction", async () => {
  const h = setup();
  h.speak.mockImplementation((text) => {
    h.order.push(`line:${text}`);
    return new Promise(() => {});
  });
  h.push("completed");
  await flush();
  h.setEnabled(false);
  await flush();
  h.setEnabled(true);
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.push("failed");
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads.", "sit", "emotion:sad"]);
});

it("with the switch off nothing is held, so turning it on replays nothing", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.setEnabled(false);
  h.push("completed");
  await flush();
  h.setEnabled(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.order).toEqual([]);
  h.push("failed");
  await flush();
  expect(h.order).toEqual(["sit", "emotion:sad"]);
});

it("a cut line stops the run", async () => {
  const h = setup();
  h.speak.mockImplementation(async (text) => {
    h.order.push(`line:${text}`);
    return "cut";
  });
  h.push("completed");
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads."]);
});

it("a window that closes instead of presenting stops the run", async () => {
  const h = setup();
  h.present.mockImplementation(async () => {
    h.order.push("present:closed");
    return "closed";
  });
  h.push("completed");
  await flush();
  expect(h.order).toEqual(["line:Let me open Threads.", "present:closed"]);
});

it("a refused sit drops the reaction with no expression and no retry", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.command.mockImplementation(async () => {
    h.order.push("sit");
    return { ok: false, reason: "busy" };
  });
  h.push("completed");
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.order).toEqual(["sit"]);
});

it("skips the expression revert while speech is owed", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.push("completed");
  await flush();
  h.state.speechOwed = true;
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.order).toEqual(["sit", "emotion:happy"]);
});

it("dispose clears the retry timer", async () => {
  const h = setup();
  h.state.pipelineBusy = true;
  h.push("completed");
  await flush();
  expect(vi.getTimerCount()).toBe(1);
  h.reaction.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("a transition holds its Thread's turn, and a reaction that sits and sets the expression fires it once", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.push("completed");
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.turns).toEqual(["hold:t1", "fire:t1"]);
});

it("a refused sit releases the Thread's turn", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.command.mockImplementation(async () => ({ ok: false, reason: "busy" }));
  h.push("completed");
  await flush();
  expect(h.turns).toEqual(["hold:t1", "release:t1"]);
});

it("switching reactions off releases a held Thread's turn", async () => {
  const h = setup();
  h.state.pipelineBusy = true;
  h.push("completed");
  await flush();
  h.setEnabled(false);
  expect(h.turns).toEqual(["hold:t1", "release:t1"]);
});

it("a run cut by its Thread's next transition leaves the turn held for the newer reaction", async () => {
  let spoken: (result: "spoken") => void = () => {};
  const h = setup();
  h.speak.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        spoken = resolve;
      }),
  );
  h.push("input-required");
  await flush();
  h.push("failed");
  spoken("spoken");
  await flush();
  expect(h.turns).toEqual(["hold:t1", "hold:t1", "fire:t1"]);
});

it("a run that finishes while a newer reaction for its Thread is held does not fire; the newer one fires after it runs", async () => {
  const lines: Array<(result: "spoken") => void> = [];
  const h = setup();
  h.speak.mockImplementation(
    () =>
      new Promise((resolve) => {
        lines.push(resolve);
      }),
  );
  h.push("input-required");
  await flush();
  h.push("working");
  h.push("input-required");
  lines[0]?.("spoken");
  await flush();
  expect(h.turns).toEqual(["hold:t1", "hold:t1"]);
  lines[1]?.("spoken");
  await flush();
  expect(h.turns).toEqual(["hold:t1", "hold:t1", "fire:t1"]);
});

it("after a reaction fires its turn, the next held reaction waits for that turn's pipeline and runs on the retry once it is idle", async () => {
  const h = setup();
  h.state.windowOpen = true;
  h.state.windows = [THREADS];
  h.state.seat = { windowNumber: 42 };
  h.state.busyAfterFire = true;
  h.push("completed", "failed");
  await flush();
  expect(h.order).toEqual(["emotion:happy"]);
  h.state.busyAfterFire = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.order).toEqual(["emotion:happy"]);
  h.state.pipelineBusy = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.order).toEqual(["emotion:happy", "emotion:sad"]);
  expect(h.turns).toEqual(["hold:t1", "hold:t2", "fire:t1", "fire:t2"]);
});
