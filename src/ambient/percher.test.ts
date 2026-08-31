import { describe, expect, it, vi } from "vitest";
import type { JumpConfig, PerchWalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import type { ScreenMonitor } from "../io/screen-geometry";
import type { TickContext, TickFn } from "../renderer";
import type { JumpOutcome } from "./jumper";
import {
  createPercher,
  nextPerchDwell,
  type PercherDeps,
  planPerchStroll,
  uncoveredSpan,
} from "./percher";

const CFG: PerchWalkConfig = {
  dwell_min_ms: 1000,
  dwell_max_ms: 2000,
  distance_min_px: 80,
  distance_max_px: 400,
  edge_margin_frac: 0.2,
};

const JUMP_CFG: JumpConfig = {
  probability: 0,
  height_up_max_frac: 0.5,
  height_down_max_frac: 1,
  gap_max_width_frac: 1.5,
  apex_lift_frac: 0.15,
  takeoff_frac: 0.4,
  land_frac: 0.67,
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

    expect(planPerchStroll({ ...base, rng: () => 1 })).toEqual({
      centerX: 1300,
      direction: 1,
    });
    expect(planPerchStroll({ ...base, currentX: 1280, rng: () => 1 })).toEqual({
      centerX: 1100,
      direction: -1,
    });
  });

  it("measures room from the current center before clamping the target", () => {
    expect(
      planPerchStroll({
        currentX: 1080,
        winLeft: 1000,
        winRight: 1400,
        charHpx: 500,
        cfg: CFG,
        rng: () => 0,
      }),
    ).toEqual({ centerX: 1160, direction: 1 });
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

const MONITOR: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 3000, height: 2000 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 3000, height: 1900 } },
};

/** A window reaching across the host's top edge (y 900) at the given x span. */
function cover(x: number, width: number, windowNumber: number): WindowRect {
  return { ...HOST, x, y: 800, width, height: 400, name: "Cover", windowNumber };
}

/** A jumpable window a short gap off the host's right edge, tops level. */
const NEIGHBOUR: WindowRect = {
  ...HOST,
  x: 1560,
  width: 400,
  name: "Chat",
  ownerName: "Messages",
  windowNumber: 7,
};

describe("uncoveredSpan", () => {
  it("keeps the whole host edge when nothing in front reaches it", () => {
    const below = { ...cover(1300, 300, 7), y: 1000 };
    expect(uncoveredSpan([below, HOST], 1, 1200)).toEqual({ left: 1000, right: 1500 });
    expect(uncoveredSpan([cover(2000, 300, 8), HOST], 1, 1200)).toEqual({
      left: 1000,
      right: 1500,
    });
  });

  it("clips to the nearest covering window on each side of the given x", () => {
    expect(uncoveredSpan([cover(900, 200, 7), cover(1310, 200, 8), HOST], 2, 1200)).toEqual({
      left: 1100,
      right: 1310,
    });
  });

  it("ignores windows behind the host", () => {
    expect(uncoveredSpan([HOST, cover(1300, 300, 7)], 0, 1200)).toEqual({
      left: 1000,
      right: 1500,
    });
  });

  it("leaves no span at all when the x itself is covered", () => {
    const span = uncoveredSpan([cover(1150, 200, 7), HOST], 1, 1200);
    expect(span.left).toBeGreaterThan(span.right);
  });
});

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
    walkAccepted?: boolean;
    walkMovesTo?: { y: number };
    windows?: () => Promise<WindowRect[]>;
    monitors?: () => Promise<ScreenMonitor[]>;
    scaleFactor?: number;
    initialPos?: { x: number; y: number };
    setPosition?: (x: number, y: number) => Promise<void>;
    outerPosition?: () => Promise<{ x: number; y: number }>;
    reducedMotion?: boolean;
    busy?: boolean;
    motion?: { id: string; kind: MotionKind | null } | null;
    rng?: () => number;
    jumpProbability?: number;
    jump?: Promise<JumpOutcome>;
    charWpx?: number | null;
  } = {},
) {
  let tick: TickFn | null = null;
  let pos = over.initialPos ?? { x: 1000, y: 600 };
  let armed = true;
  const calls: string[] = [];
  const walkTo = vi.fn((toX: number, onAccepted?: () => void): Promise<"arrived" | "lost"> => {
    if (over.walkAccepted !== false) onAccepted?.();
    if (over.walkMovesTo) {
      const scale = over.scaleFactor ?? 1;
      pos = { x: toX * scale, y: over.walkMovesTo.y };
    }
    return over.walk ?? Promise.resolve(over.walkAccepted === false ? "lost" : "arrived");
  });
  const walkerCancel = vi.fn();
  const onWalkCancel = vi.fn();
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
  const abandonSit = vi.fn(() => {
    armed = false;
    calls.push("abandon");
  });
  const release = vi.fn(() => {
    armed = false;
    calls.push("exit");
  });
  const onHostLost = vi.fn(() => {
    calls.push("fall");
  });
  const adoptSit = vi.fn(
    (
      _windowNumber: number,
      _rect: { x: number; y: number },
      _charHpx: number,
      _origin: "commit" | "adopt",
    ) => {
      armed = true;
      calls.push("adopt");
    },
  );
  const jump = vi.fn(() => {
    calls.push("jump");
    return over.jump ?? Promise.resolve<JumpOutcome>("landed");
  });
  const jumperCancel = vi.fn();
  const onTargetLost = vi.fn(() => {
    calls.push("target_lost");
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
      getCharacterWidthPx: () => (over.charWpx === undefined ? 160 : over.charWpx),
    },
    getWindow: () => ({
      outerPosition: over.outerPosition ?? (async () => ({ ...pos })),
      scaleFactor: async () => over.scaleFactor ?? 1,
      setPositionPhysical: async (x, y) => {
        if (over.setPosition) return over.setPosition(x, y);
        pos = { x, y };
        positions.push({ ...pos });
      },
    }),
    listWindows: over.windows ?? (async () => [HOST]),
    listMonitors: over.monitors ?? (async () => [MONITOR]),
    getConfig: () => CFG,
    getJumpConfig: () => ({ ...JUMP_CFG, probability: over.jumpProbability ?? 0 }),
    walker: { walkTo, cancel: walkerCancel },
    jumper: { jump, cancel: jumperCancel },
    dropSource: {
      armedSit: () =>
        armed ? { windowNumber: 42, origin: over.origin ?? ("commit" as const) } : null,
      suspendSit,
      resumeSit,
      abandonSit,
      adoptSit,
      release,
    },
    currentMotion: () =>
      over.motion === undefined ? { id: "idle", kind: "ambient" as const } : over.motion,
    isBusy: () => over.busy ?? false,
    reducedMotion: () => over.reducedMotion ?? false,
    onWalkStart: () => calls.push("avatar.walk_start"),
    onWalkEnd: () => calls.push("avatar.walk_end"),
    onWalkCancel,
    onSit: () => calls.push("avatar.window_sit"),
    onHostLost,
    onTargetLost,
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
    onWalkCancel,
    suspendSit,
    resumeSit,
    abandonSit,
    adoptSit,
    release,
    onHostLost,
    jump,
    jumperCancel,
    onTargetLost,
    /** Arm a fresh commit-origin sit, the way a later drop release would. */
    rearm: () => {
      armed = true;
    },
  };
}

describe("createPercher", () => {
  it("loops dwell to stroll to a cue-free re-sit and rearms the dwell", async () => {
    const h = makeHarness();
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.positions).toContainEqual({ x: 1000, y: 480 });
    expect(h.walkTo).toHaveBeenCalledWith(1080, expect.any(Function));
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

  it("keeps the target out from under a window covering the host edge", async () => {
    const h = makeHarness({ windows: async () => [cover(1300, 300, 7), HOST] });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledWith(900, expect.any(Function));
  });

  it("re-dwells without suspending when covers leave no room either way", async () => {
    const h = makeHarness({
      windows: async () => [cover(900, 200, 7), cover(1310, 200, 8), HOST],
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("walks the full edge past a window behind the host", async () => {
    const h = makeHarness({ windows: async () => [HOST, cover(1300, 300, 7)] });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledWith(1080, expect.any(Function));
  });

  it("re-dwells without suspending on a narrow host window", async () => {
    const narrow = { ...HOST, x: 1095, width: 210 };
    const h = makeHarness({ windows: async () => [narrow] });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("strolls out of the perch hold the sit keeps playing", async () => {
    const h = makeHarness({ motion: { id: "window_sit", kind: "state" } });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).toHaveBeenCalledTimes(1);
    expect(h.walkTo).toHaveBeenCalledWith(1080, expect.any(Function));
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["pipeline busy", { busy: true }],
    ["a reactive clip", { motion: { id: "head_pat", kind: "reactive" as const } }],
    ["a thinking hold", { motion: { id: "thinking", kind: "state" as const } }],
  ])("re-dwells before suspending when blocked by %s", async (_label, gate) => {
    const h = makeHarness(gate);
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("keeps the sit when the standing position would be clamped above the work area", async () => {
    const h = makeHarness({
      windows: async () => [{ ...HOST, y: 450 }],
      monitors: async () => [
        {
          ...MONITOR,
          workArea: { position: { x: 0, y: 100 }, size: { width: 3000, height: 1800 } },
        },
      ],
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.positions).toEqual([]);
  });

  it("applies scale factor conversions and resumes from the post-walk position", async () => {
    const h = makeHarness({
      scaleFactor: 2,
      initialPos: { x: 1980, y: 1200 },
      walkMovesTo: { y: 940 },
      rng: seqRng(0, 1, 0),
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.positions).toContainEqual({ x: 1980, y: 960 });
    expect(h.walkTo).toHaveBeenCalledWith(1070, expect.any(Function));
    expect(h.resumeSit).toHaveBeenCalledWith(430);
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
  });

  it("quietly resumes and re-dwells when the directed walk is not accepted", async () => {
    const h = makeHarness({ walkAccepted: false });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledTimes(1);
    expect(h.abandonSit).not.toHaveBeenCalled();
    expect(h.resumeSit).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["suspend", "resume", "avatar.window_sit"]);

    await h.frame(0.5);
    expect(h.walkTo).toHaveBeenCalledTimes(1);
    await h.frame(0.6);
    expect(h.walkTo).toHaveBeenCalledTimes(2);
  });

  it("is inert on a climb-origin adopted perch", async () => {
    const h = makeHarness({ origin: "adopt" });
    h.percher.start();
    await h.frame();
    await h.frame(10);

    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
  });

  it("exits and falls when the host is already gone at stroll start", async () => {
    const h = makeHarness({ windows: async () => [] });
    h.percher.start();
    await h.frame();

    await h.frame(1.1);

    // Nothing was suspended and no walk began, so the exit is the whole of it — and it
    // still leaves her standing where a window no longer is.
    expect(h.calls).toEqual(["exit", "fall"]);
    expect(h.suspendSit).not.toHaveBeenCalled();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.onHostLost).toHaveBeenCalledTimes(1);
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
    // The exit leaves her standing on nothing, so the fall follows it.
    expect(h.calls.slice(-3)).toEqual(["avatar.walk_end", "exit", "fall"]);
    expect(h.onHostLost).toHaveBeenCalledTimes(1);
  });

  it("dwells again on a fresh sit after the host vanished mid-stroll", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST];
    const h = makeHarness({ walk: walking.promise, windows: async () => windows });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    windows = [];
    await h.frame(0.8);
    expect(h.release).toHaveBeenCalledTimes(1);

    walking.resolve("arrived");
    await h.frame();
    windows = [HOST];
    h.rearm();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledTimes(2);
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
    expect(h.onHostLost).not.toHaveBeenCalled();
    await h.frame(0.8);

    expect(h.walkerCancel).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.calls.slice(-3)).toEqual(["avatar.walk_end", "exit", "fall"]);
    expect(h.onHostLost).toHaveBeenCalledTimes(1);
  });

  it("cancels user pickup mid-dwell and mid-stroll without leaking late transitions", async () => {
    const dwell = makeHarness();
    dwell.percher.start();
    await dwell.frame();
    dwell.percher.cancel();
    await dwell.frame(10);
    expect(dwell.walkTo).not.toHaveBeenCalled();
    expect(dwell.onWalkCancel).not.toHaveBeenCalled();
    expect(dwell.calls).toEqual([]);

    const walking = deferred<"arrived" | "lost">();
    const stroll = makeHarness({ walk: walking.promise });
    stroll.percher.start();
    await stroll.frame();
    await stroll.frame(1.1);
    stroll.percher.cancel();
    expect(stroll.walkerCancel).toHaveBeenCalledTimes(1);
    expect(stroll.onWalkCancel).toHaveBeenCalledTimes(1);
    const before = [...stroll.calls];

    walking.resolve("arrived");
    await stroll.frame();

    expect(stroll.calls).toEqual(before);
    expect(stroll.resumeSit).not.toHaveBeenCalled();
    expect(stroll.abandonSit).toHaveBeenCalledTimes(1);
    expect(stroll.release).not.toHaveBeenCalled();
    // A pickup is not a loss — the drag owns the body, nothing falls.
    expect(dwell.onHostLost).not.toHaveBeenCalled();
    expect(stroll.onHostLost).not.toHaveBeenCalled();
  });

  it("abandons the suspended sit when positioning the stroll throws", async () => {
    const h = makeHarness({ setPosition: async () => Promise.reject(new Error("move failed")) });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.suspendSit).toHaveBeenCalledTimes(1);
    expect(h.abandonSit).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["suspend", "abandon"]);
  });

  it("abandons the suspended sit when the post-walk position read throws", async () => {
    let positionReads = 0;
    const h = makeHarness({
      outerPosition: async () => {
        positionReads++;
        if (positionReads > 2) throw new Error("position unavailable");
        return { x: 1000, y: 600 };
      },
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(positionReads).toBe(3);
    expect(h.abandonSit).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["suspend", "avatar.walk_start", "avatar.walk_end", "abandon"]);
  });

  it("abandons a suspension when cancelled during standing placement", async () => {
    const positioned = deferred<void>();
    const h = makeHarness({ setPosition: async () => positioned.promise });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);

    h.percher.cancel();
    expect(h.abandonSit).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["suspend", "abandon"]);

    positioned.resolve();
    await h.frame();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.resumeSit).not.toHaveBeenCalled();
  });

  it("walks to the takeoff edge, leaves the old seat behind and takes the neighbour's", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // The host's right edge less the stroll's own margin, in window coordinates.
    expect(h.walkTo).toHaveBeenNthCalledWith(1, 1200, expect.any(Function));
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "abandon",
      "jump",
      "avatar.window_sit",
      "avatar.walk_end",
    ]);
    expect(h.resumeSit).not.toHaveBeenCalled();
    // The landing leg walks on along the neighbour's own top before sitting down.
    expect(h.walkTo).toHaveBeenCalledTimes(2);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
    expect(h.release).not.toHaveBeenCalled();

    h.walkTo.mockClear();
    await h.frame(1.1);
    expect(h.walkTo).toHaveBeenCalledTimes(1);
  });

  it("strolls the host as usual when the jump does not come up", async () => {
    const h = makeHarness({ windows: async () => [HOST, NEIGHBOUR] });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.jump).not.toHaveBeenCalled();
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
  });

  it("stays on the host when the character width cannot be measured", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      charWpx: null,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.jump).not.toHaveBeenCalled();
    expect(h.resumeSit).toHaveBeenCalledTimes(1);
  });

  it("falls when the target window leaves while she is in the air", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      jump: Promise.resolve("lost"),
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "abandon",
      "jump",
      "avatar.walk_end",
      "target_lost",
    ]);
    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
  });

  it("hands a mid-air pickup to the jumper and announces nothing itself", async () => {
    const flight = deferred<JumpOutcome>();
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      jump: flight.promise,
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    const before = [...h.calls];

    h.percher.cancel();
    expect(h.jumperCancel).toHaveBeenCalledTimes(1);

    flight.resolve("cancelled");
    await h.frame();

    expect(h.calls).toEqual(before);
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.onTargetLost).not.toHaveBeenCalled();
  });

  it("does not let an older attempt clear the starting state of a newer generation", async () => {
    const first = deferred<WindowRect[]>();
    const second = deferred<WindowRect[]>();
    let survey = 0;
    const windows = vi.fn(() => {
      survey++;
      if (survey === 1) return first.promise;
      if (survey === 2) return second.promise;
      return Promise.resolve([HOST]);
    });
    const h = makeHarness({ windows });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);

    h.percher.cancel();
    await h.frame();
    await h.frame(2.1);
    await h.frame(0.1);
    expect(windows).toHaveBeenCalledTimes(2);

    first.resolve([HOST]);
    await h.frame();
    await h.frame(1.1);
    await h.frame(1.1);

    expect(windows).toHaveBeenCalledTimes(2);
    second.resolve([HOST]);
    await h.frame();
  });
});
