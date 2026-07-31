/**
 * avatar-executor.test.ts — the webview end of the avatar RPC bridge.
 *
 * The executor answers queries from live client state and executes movement verbs
 * by reusing the perch flow. It carries no judgment: it never decides where to go,
 * it moves where it is told and reports what happened.
 *
 * The real perch geometry is exercised; only the OS seams (Tauri window, monitors,
 * perch settle) are faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Posture } from "../contract";
import { type AvatarExecutorDeps, createAvatarExecutor } from "./avatar-executor";
import type { AvatarRpcRequest } from "./avatar-rpc";
import type { PerchTargets, SettleOutcome } from "./window-drop-source";

/** Pet window at physical (520, 740), scale 2 → origin (260, 370) points. */
const WINDOW_POS = { x: 520, y: 740 };
const WINDOW_SIZE = { width: 400, height: 300 };
const SCALE = 2;
/** probe seatPx (40, 30) over origin (260, 370) → seat global (300, 400) points. */
const PROBE = { seatPx: { x: 40, y: 30 }, charHpx: 200 };

const MONITORS = [
  { position: { x: 0, y: 0 }, size: { width: 1000, height: 800 } },
  { position: { x: 1000, y: 0 }, size: { width: 2000, height: 1000 } },
];

const TARGETS: PerchTargets = {
  windows: [
    { app: "Notes", title: "Shopping", rect: { x: 1000, y: 600, width: 400, height: 300 } },
    { app: "Safari", title: "Docs", rect: { x: 40, y: 50, width: 300, height: 200 } },
  ],
  edges: ["left", "right"],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness(over: Partial<AvatarExecutorDeps> = {}) {
  let handler: ((req: AvatarRpcRequest) => void) | undefined;
  const unsubscribe = vi.fn();
  const responses: Array<{ id: string; result: unknown }> = [];
  const setPositionPhysical = vi.fn(async () => {});
  const settle = vi.fn(async (): Promise<SettleOutcome> => ({ kind: "none" }));
  const release = vi.fn();
  const perchTargets = vi.fn(async () => TARGETS);
  const posture: Posture | undefined = { state: "sitting" };

  const deps: AvatarExecutorDeps = {
    subscribe: (cb) => {
      handler = cb;
      return unsubscribe;
    },
    respond: (id, result) => {
      responses.push({ id, result });
    },
    perch: { settle, perchTargets, release },
    renderer: { getPerchProbe: () => PROBE },
    getWindow: () => ({
      outerPosition: async () => WINDOW_POS,
      outerSize: async () => WINDOW_SIZE,
      scaleFactor: async () => SCALE,
      setPositionPhysical,
    }),
    listMonitors: async () => MONITORS,
    getPosture: () => posture,
    getVrm: () => ({ id: "carlotta", label: "Carlotta" }),
    ...over,
  };

  const executor = createAvatarExecutor(deps);
  executor.start();

  let seq = 0;
  /** Fire one RPC and await the executor's answer. */
  async function call(method: AvatarRpcRequest["method"], params?: unknown): Promise<unknown> {
    const id = `req-${seq++}`;
    handler?.({ id, method, ...(params === undefined ? {} : { params }) });
    for (let i = 0; i < 30 && !responses.some((r) => r.id === id); i++) await Promise.resolve();
    return responses.find((r) => r.id === id)?.result;
  }

  /** Fire one RPC without waiting — for busy / interrupt races. */
  function fire(method: AvatarRpcRequest["method"], params?: unknown): string {
    const id = `req-${seq++}`;
    handler?.({ id, method, ...(params === undefined ? {} : { params }) });
    return id;
  }

  function answerOf(id: string): unknown {
    return responses.find((r) => r.id === id)?.result;
  }

  return {
    executor,
    call,
    fire,
    answerOf,
    responses,
    setPositionPhysical,
    settle,
    release,
    perchTargets,
    unsubscribe,
  };
}

/** Let the executor's awaits unwind. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe("avatar-executor — state", () => {
  it("answers with window position, monitor, posture, vrm and the idle moving flag", async () => {
    const h = harness();

    const state = await h.call("state");

    expect(state).toEqual({
      position: { x: 520, y: 740, monitor: 0 },
      posture: { state: "sitting" },
      vrm: { id: "carlotta", label: "Carlotta" },
      moving: false,
    });
  });

  it("reports a null posture when the avatar is idle", async () => {
    const h = harness({ getPosture: () => undefined });

    expect(await h.call("state")).toMatchObject({ posture: null });
  });

  it("reports a null monitor when no monitor contains the window", async () => {
    const h = harness({ listMonitors: async () => [] });

    expect(await h.call("state")).toMatchObject({ position: { x: 520, y: 740, monitor: null } });
  });

  it("reports moving while a command is in flight", async () => {
    const gate = deferred<SettleOutcome>();
    const h = harness({
      perch: {
        settle: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();

    expect(await h.call("state")).toMatchObject({ moving: true });

    gate.resolve({ kind: "sit", app: "Notes", window_title: "Shopping" });
    await flush();
    expect(await h.call("state")).toMatchObject({ moving: false });
  });
});

describe("avatar-executor — perch targets", () => {
  it("answers with the perch source's tracked candidates", async () => {
    const h = harness();

    expect(await h.call("perch_targets")).toEqual(TARGETS);
    expect(h.perchTargets).toHaveBeenCalled();
  });
});

describe("avatar-executor — sit_on_window", () => {
  it("moves the seat onto the named window's top edge and settles without a cue", async () => {
    const h = harness();
    h.settle.mockResolvedValue({ kind: "sit", app: "Notes", window_title: "Shopping" });

    const result = await h.call("command", { action: "sit_on_window", app: "Notes" });

    // Desired seat = top-edge center (1200, 600); seat is at (300, 400) → delta (900, 200) points.
    // New physical origin = (520 + 900*2, 740 + 200*2).
    expect(h.setPositionPhysical).toHaveBeenCalledWith(2320, 1140);
    expect(h.settle).toHaveBeenCalledWith({ suppressCue: true });
    expect(result).toEqual({ ok: true });
  });

  it("matches the app name case-insensitively", async () => {
    const h = harness();
    h.settle.mockResolvedValue({ kind: "sit", app: "Notes", window_title: "Shopping" });

    expect(await h.call("command", { action: "sit_on_window", app: "notes" })).toEqual({
      ok: true,
    });
  });

  it("reports not_found without moving when no window matches", async () => {
    const h = harness();

    expect(await h.call("command", { action: "sit_on_window", app: "Xcode" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(h.setPositionPhysical).not.toHaveBeenCalled();
  });

  it("reports not_found when the settle lands somewhere else", async () => {
    const h = harness();
    h.settle.mockResolvedValue({ kind: "none" });

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports unsupported when no perch probe is available", async () => {
    const h = harness({ renderer: { getPerchProbe: () => null } });

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("avatar-executor — peek", () => {
  it("moves the seat onto the frontmost window's requested edge", async () => {
    const h = harness();
    h.settle.mockResolvedValue({
      kind: "peek",
      side: "right",
      app: "Notes",
      window_title: "Shopping",
    });

    const result = await h.call("command", { action: "peek", side: "right" });

    // Right edge mid-height = (1400, 750); delta from (300, 400) = (1100, 350) points.
    expect(h.setPositionPhysical).toHaveBeenCalledWith(2720, 1440);
    expect(h.settle).toHaveBeenCalledWith({ suppressCue: true });
    expect(result).toEqual({ ok: true });
  });

  it("targets the left edge for a left peek", async () => {
    const h = harness();
    h.settle.mockResolvedValue({
      kind: "peek",
      side: "left",
      app: "Notes",
      window_title: "Shopping",
    });

    await h.call("command", { action: "peek", side: "left" });

    // Left edge mid-height = (1000, 750); delta = (700, 350) points.
    expect(h.setPositionPhysical).toHaveBeenCalledWith(1920, 1440);
  });

  it("reports not_found when the settle lands on the other side", async () => {
    const h = harness();
    h.settle.mockResolvedValue({
      kind: "peek",
      side: "left",
      app: "Notes",
      window_title: "Shopping",
    });

    expect(await h.call("command", { action: "peek", side: "right" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports not_found when there is no window to peek around", async () => {
    const h = harness({
      perch: {
        settle: vi.fn(async () => ({ kind: "none" }) as SettleOutcome),
        perchTargets: async () => ({ windows: [], edges: ["left", "right"] }),
        release: vi.fn(),
      },
    });

    expect(await h.call("command", { action: "peek", side: "left" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("avatar-executor — move_to", () => {
  it("centers the window on the requested monitor", async () => {
    const h = harness();

    const result = await h.call("command", {
      action: "move_to",
      spot: "center",
      monitor: 1,
    });

    // Monitor 1 spans x 1000..3000, y 0..1000; window is 400x300.
    expect(h.setPositionPhysical).toHaveBeenCalledWith(1800, 350);
    expect(result).toEqual({ ok: true });
  });

  it("uses the monitor holding the window when none is named", async () => {
    const h = harness();

    await h.call("command", { action: "move_to", spot: "center" });

    // Window origin (520, 740) lies on monitor 0 (1000x800).
    expect(h.setPositionPhysical).toHaveBeenCalledWith(300, 250);
  });

  it("insets the window from the corner for a corner spot", async () => {
    const h = harness();

    await h.call("command", { action: "move_to", spot: "bottom-right", monitor: 0 });

    // 1000-400-24 = 576, 800-300-24 = 476.
    expect(h.setPositionPhysical).toHaveBeenCalledWith(576, 476);
  });

  it("releases any perch before moving", async () => {
    const h = harness();

    await h.call("command", { action: "move_to", spot: "top-left", monitor: 0 });

    expect(h.release).toHaveBeenCalled();
    expect(h.setPositionPhysical).toHaveBeenCalledWith(24, 24);
  });

  it("reports not_found for a monitor index out of range", async () => {
    const h = harness();

    expect(await h.call("command", { action: "move_to", spot: "center", monitor: 7 })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(h.setPositionPhysical).not.toHaveBeenCalled();
  });

  it("reports unsupported when no monitor is enumerable", async () => {
    const h = harness({ listMonitors: async () => [] });

    expect(await h.call("command", { action: "move_to", spot: "center" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("avatar-executor — stand_down", () => {
  it("releases the perch and reports ok", async () => {
    const h = harness();

    expect(await h.call("command", { action: "stand_down" })).toEqual({ ok: true });
    expect(h.release).toHaveBeenCalledOnce();
  });
});

describe("avatar-executor — concurrency and interruption", () => {
  it("rejects a second command while one is running", async () => {
    const gate = deferred<SettleOutcome>();
    const h = harness({
      perch: {
        settle: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();
    const second = await h.call("command", { action: "stand_down" });

    expect(second).toEqual({ ok: false, reason: "busy" });
    gate.resolve({ kind: "sit", app: "Notes", window_title: "Shopping" });
    await flush();
  });

  it("aborts the running command with interrupted when the user drags", async () => {
    const gate = deferred<SettleOutcome>();
    const h = harness({
      perch: {
        settle: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    const id = h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();
    h.executor.noteUserDrag();
    gate.resolve({ kind: "sit", app: "Notes", window_title: "Shopping" });
    await flush();

    expect(h.answerOf(id)).toEqual({ ok: false, reason: "interrupted" });
  });

  it("accepts a new command once the previous one finished", async () => {
    const h = harness();
    h.settle.mockResolvedValue({ kind: "sit", app: "Notes", window_title: "Shopping" });

    await h.call("command", { action: "sit_on_window", app: "Notes" });

    expect(await h.call("command", { action: "stand_down" })).toEqual({ ok: true });
  });

  it("answers queries while a command is running", async () => {
    const gate = deferred<SettleOutcome>();
    const h = harness({
      perch: {
        settle: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();

    expect(await h.call("perch_targets")).toEqual(TARGETS);
    gate.resolve({ kind: "none" });
    await flush();
  });
});

describe("avatar-executor — malformed input and lifecycle", () => {
  it("reports unsupported for an unknown method", async () => {
    const h = harness();

    expect(await h.call("state" as never, undefined)).toBeDefined();
    expect(await h.call("teleport" as never)).toEqual({ ok: false, reason: "unsupported" });
  });

  it("reports unsupported for a malformed command payload", async () => {
    const h = harness();

    expect(await h.call("command", { action: "sit_on_window" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("stop unsubscribes from the channel", () => {
    const h = harness();

    h.executor.stop();

    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("avatar-executor — failure containment", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness({
      getWindow: () => ({
        outerPosition: async () => {
          throw new Error("no window");
        },
        outerSize: async () => WINDOW_SIZE,
        scaleFactor: async () => SCALE,
        setPositionPhysical: vi.fn(async () => {}),
      }),
    });
  });

  it("still answers state with a null position when the window is unreadable", async () => {
    expect(await h.call("state")).toMatchObject({ position: null, moving: false });
  });

  it("reports unsupported when a command cannot read the window", async () => {
    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
