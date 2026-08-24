/**
 * avatar-executor.test.ts — the webview end of the avatar RPC bridge.
 *
 * The executor answers queries from live client state and forwards movement verbs to
 * the perch source's programmatic placement. It carries no judgment: it never decides
 * where to go, it moves where it is told and reports what happened.
 *
 * Only the OS seams (Tauri window, monitors) and the placement call are faked; the
 * placement geometry itself is covered in window-drop-source.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import type { Posture } from "../contract";
import { type AvatarExecutorDeps, createAvatarExecutor } from "./avatar-executor";
import type { AvatarRpcRequest } from "./avatar-rpc";
import type {
  PerchTargets,
  PlacementOptions,
  PlacementRequest,
  PlacementResult,
} from "./window-drop-source";

const WINDOW_POS = { x: 520, y: 740 };
const WINDOW_SIZE = { width: 400, height: 300 };

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
  // Parameters declared so the abort-signal test can read the options argument.
  const placeOn = vi.fn(
    async (_request: PlacementRequest, _opts?: PlacementOptions): Promise<PlacementResult> => ({
      ok: true,
      kind: "sit",
    }),
  );
  const release = vi.fn();
  const perchTargets = vi.fn(async () => TARGETS);
  const posture: Posture = { state: "sitting" };
  const noteAvatarMoved = vi.fn();

  const deps: AvatarExecutorDeps = {
    subscribe: (cb) => {
      handler = cb;
      return unsubscribe;
    },
    respond: (id, result) => {
      responses.push({ id, result });
    },
    perch: { placeOn, perchTargets, release },
    getWindow: () => ({
      outerPosition: async () => WINDOW_POS,
      outerSize: async () => WINDOW_SIZE,
      setPositionPhysical,
    }),
    listMonitors: async () => MONITORS,
    getPosture: () => posture,
    getVrm: () => ({ id: "carlotta", label: "Carlotta" }),
    noteAvatarMoved,
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
    placeOn,
    release,
    perchTargets,
    unsubscribe,
    noteAvatarMoved,
  };
}

/** Let the executor's awaits unwind. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe("avatar-executor — state", () => {
  it("answers with window position, monitor, posture, vrm and the idle moving flag", async () => {
    const h = harness();

    expect(await h.call("state")).toEqual({
      position: { x: 520, y: 740, monitor: 0 },
      posture: { state: "sitting" },
      vrm: { id: "carlotta", label: "Carlotta" },
      moving: false,
    });
  });

  it("reports standing when the avatar is idle", async () => {
    const h = harness({ getPosture: () => ({ state: "standing" }) });

    expect(await h.call("state")).toMatchObject({ posture: { state: "standing" } });
  });

  it("reports a null monitor when no monitor contains the window", async () => {
    const h = harness({ listMonitors: async () => [] });

    expect(await h.call("state")).toMatchObject({ position: { x: 520, y: 740, monitor: null } });
  });

  it("reports moving while a command is in flight", async () => {
    const gate = deferred<PlacementResult>();
    const h = harness({
      perch: {
        placeOn: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();

    expect(await h.call("state")).toMatchObject({ moving: true });

    gate.resolve({ ok: true, kind: "sit" });
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
  it("forwards the named app to the placement and reports ok", async () => {
    const h = harness();

    const result = await h.call("command", { action: "sit_on_window", app: "Notes" });

    expect(h.placeOn).toHaveBeenCalledWith({ kind: "sit", app: "Notes" }, expect.anything());
    expect(result).toEqual({ ok: true });
  });

  it("passes the placement's not_found through", async () => {
    const h = harness();
    h.placeOn.mockResolvedValue({ ok: false, reason: "not_found" });

    expect(await h.call("command", { action: "sit_on_window", app: "Xcode" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("passes the placement's blocked through when a window covers the seat", async () => {
    const h = harness();
    h.placeOn.mockResolvedValue({ ok: false, reason: "blocked" });

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("passes the placement's unsupported through", async () => {
    const h = harness();
    h.placeOn.mockResolvedValue({ ok: false, reason: "unsupported" });

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("avatar-executor — peek", () => {
  it("forwards the requested side to the placement", async () => {
    const h = harness();
    h.placeOn.mockResolvedValue({ ok: true, kind: "peek" });

    const result = await h.call("command", { action: "peek", side: "right" });

    expect(h.placeOn).toHaveBeenCalledWith({ kind: "peek", side: "right" }, expect.anything());
    expect(result).toEqual({ ok: true });
  });

  it("passes the placement's not_found through when nothing is on screen", async () => {
    const h = harness();
    h.placeOn.mockResolvedValue({ ok: false, reason: "not_found" });

    expect(await h.call("command", { action: "peek", side: "left" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("avatar-executor — move_to", () => {
  it("centers the window on the requested monitor", async () => {
    const h = harness();

    const result = await h.call("command", { action: "move_to", spot: "center", monitor: 1 });

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

  it("reports unsupported when the window cannot be read", async () => {
    const h = harness({
      getWindow: () => ({
        outerPosition: async () => {
          throw new Error("no window");
        },
        outerSize: async () => WINDOW_SIZE,
        setPositionPhysical: vi.fn(async () => {}),
      }),
    });

    expect(await h.call("command", { action: "move_to", spot: "center" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("notes the avatar moved once a move_to succeeds", async () => {
    const h = harness();

    const result = await h.call("command", { action: "move_to", spot: "center" });

    expect(result).toEqual({ ok: true });
    expect(h.noteAvatarMoved).toHaveBeenCalledTimes(1);
  });

  it("does not note the move when the monitor index is out of range", async () => {
    const h = harness();

    await h.call("command", { action: "move_to", spot: "center", monitor: 7 });

    expect(h.noteAvatarMoved).not.toHaveBeenCalled();
  });

  it("does not note the move when no monitor is enumerable", async () => {
    const h = harness({ listMonitors: async () => [] });

    await h.call("command", { action: "move_to", spot: "center" });

    expect(h.noteAvatarMoved).not.toHaveBeenCalled();
  });

  it("reports interrupted and does not note the move when a drag starts right after the position is set", async () => {
    const gate = deferred<void>();
    const h = harness({
      getWindow: () => ({
        outerPosition: async () => WINDOW_POS,
        outerSize: async () => WINDOW_SIZE,
        setPositionPhysical: () => gate.promise,
      }),
    });

    const id = h.fire("command", { action: "move_to", spot: "center" });
    await flush();
    h.executor.noteUserDrag();
    gate.resolve();
    await flush();

    expect(h.release).toHaveBeenCalled();
    expect(h.answerOf(id)).toEqual({ ok: false, reason: "interrupted" });
    expect(h.noteAvatarMoved).not.toHaveBeenCalled();
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
    const gate = deferred<PlacementResult>();
    const h = harness({
      perch: {
        placeOn: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();
    const second = await h.call("command", { action: "stand_down" });

    expect(second).toEqual({ ok: false, reason: "busy" });
    gate.resolve({ ok: true, kind: "sit" });
    await flush();
  });

  it("aborts the running command with interrupted when the user drags", async () => {
    const gate = deferred<PlacementResult>();
    const h = harness({
      perch: {
        placeOn: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    const id = h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();
    h.executor.noteUserDrag();
    gate.resolve({ ok: true, kind: "sit" });
    await flush();

    expect(h.answerOf(id)).toEqual({ ok: false, reason: "interrupted" });
  });

  it("refuses a command that arrives while the user is already dragging", async () => {
    const h = harness();
    h.executor.noteUserDrag();

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "interrupted",
    });
    expect(h.placeOn).not.toHaveBeenCalled();
  });

  it("accepts commands again once the drag ends", async () => {
    const h = harness();
    h.executor.noteUserDrag();
    h.executor.noteUserDragEnd();

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: true,
    });
    expect(h.placeOn).toHaveBeenCalled();
  });

  it("hands the placement an abort signal that follows the drag state", async () => {
    const h = harness();

    await h.call("command", { action: "sit_on_window", app: "Notes" });

    const opts = h.placeOn.mock.calls[0][1];
    expect(opts?.shouldAbort?.()).toBe(false);
    h.executor.noteUserDrag();
    expect(opts?.shouldAbort?.()).toBe(true);
  });

  it("clears moving after a command throws, so the next one is not refused as busy", async () => {
    const h = harness({
      perch: {
        placeOn: vi.fn(async () => {
          throw new Error("placement exploded");
        }),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    expect(await h.call("command", { action: "sit_on_window", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(await h.call("command", { action: "stand_down" })).toEqual({ ok: true });
  });

  it("accepts a new command once the previous one finished", async () => {
    const h = harness();

    await h.call("command", { action: "sit_on_window", app: "Notes" });

    expect(await h.call("command", { action: "stand_down" })).toEqual({ ok: true });
  });

  it("answers queries while a command is running", async () => {
    const gate = deferred<PlacementResult>();
    const h = harness({
      perch: {
        placeOn: vi.fn(() => gate.promise),
        perchTargets: async () => TARGETS,
        release: vi.fn(),
      },
    });

    h.fire("command", { action: "sit_on_window", app: "Notes" });
    await flush();

    expect(await h.call("perch_targets")).toEqual(TARGETS);
    gate.resolve({ ok: true, kind: "sit" });
    await flush();
  });
});

describe("avatar-executor — malformed input and lifecycle", () => {
  it("reports unsupported for an unknown method", async () => {
    const h = harness();

    expect(await h.call("teleport" as never)).toEqual({ ok: false, reason: "unsupported" });
  });

  it("reports unsupported for a malformed command payload", async () => {
    const h = harness();

    expect(await h.call("command", { action: "sit_on_window" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(h.placeOn).not.toHaveBeenCalled();
  });

  it("reports unsupported for an empty app name instead of matching everything", async () => {
    const h = harness();

    expect(await h.call("command", { action: "sit_on_window", app: "" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(h.placeOn).not.toHaveBeenCalled();
  });

  it("reports unsupported for a whitespace-only app name", async () => {
    const h = harness();

    expect(await h.call("command", { action: "sit_on_window", app: "   " })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(h.placeOn).not.toHaveBeenCalled();
  });

  it("trims a padded app name before placing", async () => {
    const h = harness();

    await h.call("command", { action: "sit_on_window", app: "  Notes  " });

    expect(h.placeOn).toHaveBeenCalledWith({ kind: "sit", app: "Notes" }, expect.anything());
  });

  it("still answers state with a null position when the window is unreadable", async () => {
    const h = harness({
      getWindow: () => ({
        outerPosition: async () => {
          throw new Error("no window");
        },
        outerSize: async () => WINDOW_SIZE,
        setPositionPhysical: vi.fn(async () => {}),
      }),
    });

    expect(await h.call("state")).toMatchObject({ position: null, moving: false });
  });

  it("stop unsubscribes from the channel", () => {
    const h = harness();

    h.executor.stop();

    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});
