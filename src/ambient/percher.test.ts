import { describe, expect, it, vi } from "vitest";
import type { PerchWalkConfig } from "../config/load";
import type { WindowRect } from "../contract";
import type { TickContext, TickFn } from "../renderer";
import { createPercher, nextPerchDwell, type PercherDeps, planPerchStroll } from "./percher";

const CFG: PerchWalkConfig = {
  dwell_min_ms: 1000,
  dwell_max_ms: 2000,
  distance_min_px: 80,
  distance_max_px: 400,
  edge_margin_frac: 0.2,
};

function seqRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("perch-walk planning", () => {
  it("draws the configured dwell duration", () => {
    expect(nextPerchDwell(CFG, () => 0)).toBe(1000);
    expect(nextPerchDwell(CFG, () => 0.5)).toBe(1500);
    expect(nextPerchDwell(CFG, () => 1)).toBe(2000);
  });

  it("keeps the target center inside both char-height margins", () => {
    const base = {
      currentX: 1120,
      winLeft: 1000,
      winRight: 1400,
      charHpx: 500,
      cfg: CFG,
    };

    expect(planPerchStroll({ ...base, rng: seqRng(0, 1) })).toEqual({
      centerX: 1300,
      direction: 1,
    });
    expect(planPerchStroll({ ...base, currentX: 1280, rng: seqRng(0, 1) })).toEqual({
      centerX: 1100,
      direction: -1,
    });
  });

  it("skips a narrow ledge when neither direction has the minimum room", () => {
    expect(
      planPerchStroll({
        currentX: 1125,
        winLeft: 1000,
        winRight: 1250,
        charHpx: 500,
        cfg: CFG,
        rng: () => 0,
      }),
    ).toBeNull();
  });
});

const HOST: WindowRect = {
  x: 1000,
  y: 900,
  width: 500,
  height: 600,
  name: "Meeting notes",
  ownerName: "Notes",
  pid: 11,
  windowNumber: 42,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeHarness(
  over: {
    origin?: "commit" | "adopt";
    walk?: Promise<"arrived" | "lost">;
    windows?: () => Promise<WindowRect[]>;
    rng?: () => number;
  } = {},
) {
  let tick: TickFn | null = null;
  let pos = { x: 1000, y: 600 };
  let armed = true;
  const calls: string[] = [];
  const walkTo = vi.fn((_toX: number) => over.walk ?? Promise.resolve("arrived" as const));
  const walkerCancel = vi.fn();
  const suspendSit = vi.fn(() => {
    if (!armed) return null;
    calls.push("suspend");
    return {
      windowNumber: 42,
      origin: over.origin ?? "commit",
      rect: { x: HOST.x, y: HOST.y },
      charHpx: 500,
    } as const;
  });
  const resumeSit = vi.fn((_edgeLocalYpx: number) => {
    calls.push("resume");
  });
  const release = vi.fn(() => {
    armed = false;
    calls.push("exit");
  });
  const positions: Array<{ x: number; y: number }> = [];
  const deps: PercherDeps = {
    renderer: {
      onTick: (fn) => {
        tick = fn;
        return () => {
          tick = null;
        };
      },
      getCharacterAnchor: () => ({ x: 200, y: 420 }),
      getPerchProbe: () => ({ seatPx: { x: 200, y: 300 }, charHpx: 500 }),
    },
    getWindow: () => ({
      outerPosition: async () => ({ ...pos }),
      scaleFactor: async () => 1,
      setPositionPhysical: async (x, y) => {
        pos = { x, y };
        positions.push({ ...pos });
      },
    }),
    listWindows: over.windows ?? (async () => [HOST]),
    getConfig: () => CFG,
    walker: { walkTo, cancel: walkerCancel },
    dropSource: {
      armedSit: () =>
        armed ? { windowNumber: 42, origin: over.origin ?? ("commit" as const) } : null,
      suspendSit,
      resumeSit,
      release,
    },
    onWalkStart: () => calls.push("avatar.walk_start"),
    onWalkEnd: () => calls.push("avatar.walk_end"),
    onSit: () => calls.push("avatar.window_sit"),
    rng: over.rng ?? seqRng(0, 1, 0),
  };
  const percher = createPercher(deps);
  let elapsed = 0;
  const frame = async (dt = 0.1): Promise<void> => {
    elapsed += dt;
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return {
    percher,
    frame,
    calls,
    positions,
    walkTo,
    walkerCancel,
    suspendSit,
    resumeSit,
    release,
  };
}

describe("createPercher", () => {
  it("loops dwell to stroll to a cue-free re-sit and rearms the dwell", async () => {
    const h = makeHarness();
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.positions).toContainEqual({ x: 1000, y: 480 });
    expect(h.walkTo).toHaveBeenCalledWith(1080);
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
    expect(h.release).not.toHaveBeenCalled();

    h.walkTo.mockClear();
    await h.frame(0.5);
    expect(h.walkTo).not.toHaveBeenCalled();
    await h.frame(0.6);
    expect(h.walkTo).toHaveBeenCalledTimes(1);
  });

  it("re-dwells without suspending on a narrow host window", async () => {
    const narrow = { ...HOST, width: 210 };
    const h = makeHarness({ windows: async () => [narrow] });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("is inert on a climb-origin adopted perch", async () => {
    const h = makeHarness({ origin: "adopt" });
    h.percher.start();
    await h.frame();
    await h.frame(10);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
  });

  it("uses the existing exit path when the host vanishes mid-stroll", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST];
    const h = makeHarness({ walk: walking.promise, windows: async () => windows });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    windows = [];

    await h.frame(0.8);

    expect(h.walkerCancel).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
  });

  it("uses the existing exit path after two moved-host samples beyond MOVE_TH", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST];
    const h = makeHarness({ walk: walking.promise, windows: async () => windows });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    windows = [{ ...HOST, x: HOST.x + 13 }];

    await h.frame(0.8);
    expect(h.release).not.toHaveBeenCalled();
    await h.frame(0.8);

    expect(h.walkerCancel).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
  });

  it("cancels user pickup mid-dwell and mid-stroll without leaking late transitions", async () => {
    const dwell = makeHarness();
    dwell.percher.start();
    await dwell.frame();
    dwell.percher.cancel();
    await dwell.frame(10);
    expect(dwell.walkTo).not.toHaveBeenCalled();
    expect(dwell.calls).toEqual([]);

    const walking = deferred<"arrived" | "lost">();
    const stroll = makeHarness({ walk: walking.promise });
    stroll.percher.start();
    await stroll.frame();
    await stroll.frame(1.1);
    stroll.percher.cancel();
    expect(stroll.walkerCancel).toHaveBeenCalledTimes(1);
    const before = [...stroll.calls];

    walking.resolve("arrived");
    await stroll.frame();

    expect(stroll.calls).toEqual(before);
    expect(stroll.resumeSit).not.toHaveBeenCalled();
    expect(stroll.release).not.toHaveBeenCalled();
  });
});
