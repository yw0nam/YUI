import { describe, expect, it, vi } from "vitest";
import type { FallConfig, JumpConfig, PerchWalkConfig } from "../config/load";
import type { MotionKind, WindowRect } from "../contract";
import type { ScreenMonitor } from "../io/screen-geometry";
import type { TickContext, TickFn } from "../renderer";
import type { JumpOutcome } from "./jumper";
import {
  createPercher,
  nextPerchDwell,
  type PercherDeps,
  planPerchStroll,
  planStepOff,
  walkableLedge,
} from "./percher";

const CFG: PerchWalkConfig = {
  dwell_min_ms: 1000,
  dwell_max_ms: 2000,
  distance_min_px: 80,
  distance_max_px: 400,
  edge_margin_frac: 0.2,
  level_tolerance_px: 8,
};

const JUMP_CFG: JumpConfig = {
  probability: 0,
  height_up_max_frac: 0.5,
  height_down_max_frac: 1,
  gap_max_width_frac: 1.5,
  apex_lift_frac: 0.15,
  takeoff_frac: 0.4,
  land_frac: 0.67,
  flight_timeout_ms: 4000,
};

const FALL_CFG: FallConfig = {
  gravity_px_s2: 1600,
  max_speed_px_s: 1200,
  min_drop_frac: 0.2,
  cue_cooldown_ms: 60_000,
  land_room_frac: 0.5,
  step_off_probability: 0,
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

describe("planStepOff", () => {
  const base = { roomPx: 80, workArea: { left: 0, right: 1728 }, rng: () => 0 };

  it("leaves by the nearer edge while both stay on the screen", () => {
    expect(planStepOff({ ...base, currentX: 1200, span: { left: 1000, right: 1500 } })).toEqual({
      edge: "left",
      toX: 920,
    });
  });

  it("leaves by the far edge when the nearer one is off the screen", () => {
    expect(planStepOff({ ...base, currentX: 100, span: { left: 50, right: 1400 } })).toEqual({
      edge: "right",
      toX: 1480,
    });
  });

  it("stays on the window when neither edge leads anywhere on the screen", () => {
    expect(planStepOff({ ...base, currentX: 100, span: { left: 50, right: 1700 } })).toBeNull();
  });

  it("passes an edge landing on the work area's right bound, which is off the screen", () => {
    // 1648 + 80 is the first x past the last one any monitor contains.
    expect(planStepOff({ ...base, currentX: 1600, span: { left: 200, right: 1648 } })).toEqual({
      edge: "left",
      toX: 120,
    });
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

/** A window whose top sits level with the host's, at the given stretch of x. */
function level(x: number, width: number, windowNumber: number, y = HOST.y): WindowRect {
  return { ...HOST, x, y, width, name: "Level", windowNumber };
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

/** A window butting against the host's right edge, level with it: one ledge with the host. */
const LEDGE = level(1500, 500, 7);

describe("walkableLedge", () => {
  const ledge = (windows: WindowRect[], hostIndex: number, currentX = 1200) =>
    walkableLedge({ windows, hostIndex, currentX, tolerancePx: 8 });

  it("is the host's own uncovered stretch when nothing is level with it", () => {
    expect(ledge([HOST], 0)).toEqual({ left: 1000, right: 1500, surfaces: [HOST] });
  });

  it("runs on across a level neighbour touching the host's right edge", () => {
    const right = level(1500, 400, 7);
    expect(ledge([HOST, right], 0)).toEqual({ left: 1000, right: 1900, surfaces: [HOST, right] });
  });

  it("runs on across a level neighbour raised in front of the host", () => {
    const front = level(1300, 400, 7);
    expect(ledge([front, HOST], 1)).toEqual({ left: 1000, right: 1700, surfaces: [HOST, front] });
  });

  it("runs on across a level neighbour reaching the host's left edge", () => {
    const left = level(600, 400, 7);
    expect(ledge([HOST, left], 0)).toEqual({ left: 600, right: 1500, surfaces: [HOST, left] });
  });

  it("leaves a neighbour a tolerance and a pixel off the host's height to the jump", () => {
    expect(ledge([HOST, level(1500, 400, 7, HOST.y - 9)], 0).right).toBe(1500);
    expect(ledge([HOST, level(1500, 400, 7, HOST.y + 9)], 0).right).toBe(1500);
  });

  it("leaves a neighbour a pixel clear of the host to the jump", () => {
    expect(ledge([HOST, level(1501, 400, 7)], 0).right).toBe(1500);
  });

  it("chains a third window onto the second", () => {
    const first = level(1500, 400, 7, HOST.y + 4);
    const second = level(1900, 400, 8, HOST.y - 4);
    expect(ledge([HOST, first, second], 0)).toEqual({
      left: 1000,
      right: 2300,
      surfaces: [HOST, first, second],
    });
  });

  it("measures every height against the host, so a chain cannot drift off it", () => {
    const first = level(1500, 400, 7, HOST.y + 6);
    const second = level(1900, 400, 8, HOST.y + 14);
    expect(ledge([HOST, first, second], 0)).toEqual({
      left: 1000,
      right: 1900,
      surfaces: [HOST, first],
    });
  });

  it("stops at a seam a window in front covers", () => {
    const behind = level(1500, 400, 7);
    expect(ledge([cover(1500, 200, 9), HOST, behind], 1)).toEqual({
      left: 1000,
      right: 1500,
      surfaces: [HOST],
    });
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
    /** Resolve the walk "arrived" without ever accepting — she is already on the spot. */
    arrivedInPlace?: boolean;
    /** Outcome of every walk after the first, so a landing leg can fail on its own. */
    legWalk?: "arrived" | "lost";
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
    jumpOutcome?: JumpOutcome;
    charWpx?: number | null;
    /** false models a character with no seat — the fall took it. */
    armed?: boolean;
    stepOffProbability?: number;
    /** null models a VRM the renderer cannot project yet. */
    anchor?: () => { x: number; y: number } | null;
  } = {},
) {
  let tick: TickFn | null = null;
  let pos = over.initialPos ?? { x: 1000, y: 600 };
  let armed = over.armed ?? true;
  let motion = over.motion;
  const calls: string[] = [];
  let walks = 0;
  const walkTo = vi.fn((toX: number, onAccepted?: () => void): Promise<"arrived" | "lost"> => {
    walks++;
    if (over.legWalk && walks > 1) return Promise.resolve(over.legWalk);
    if (over.walkAccepted !== false && !over.arrivedInPlace) onAccepted?.();
    if (over.walkMovesTo) {
      const scale = over.scaleFactor ?? 1;
      pos = { x: toX * scale, y: over.walkMovesTo.y };
    }
    return over.walk ?? Promise.resolve(over.walkAccepted === false ? "lost" : "arrived");
  });
  const walkerCancel = vi.fn();
  const onWalkCancel = vi.fn(() => {
    calls.push("avatar.walk_cancel");
  });
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
  const jump = vi.fn((_plan: unknown, _at: unknown, onTakeoff?: () => void) => {
    const outcome = over.jump ?? Promise.resolve(over.jumpOutcome ?? "landed");
    // A refused jump never left the ground, so nothing announces a takeoff.
    if (over.jumpOutcome !== "refused") {
      calls.push("jump");
      onTakeoff?.();
    }
    return outcome;
  });
  const jumperCancel = vi.fn();
  const onTargetLost = vi.fn(() => {
    calls.push("target_lost");
  });
  const onTakeoff = vi.fn(() => {
    calls.push("avatar.jump");
  });
  const onStepOff = vi.fn(() => {
    calls.push("step_off");
  });
  const setBodyYaw = vi.fn();
  const positions: Array<{ x: number; y: number }> = [];
  const deps: PercherDeps = {
    renderer: {
      onTick: (fn) => {
        tick = fn;
        return () => {
          tick = null;
        };
      },
      getCharacterAnchor: over.anchor ?? (() => ({ x: 200, y: 420 })),
      getPerchProbe: () => ({ seatPx: { x: 200, y: 300 }, charHpx: 500 }),
      getCharacterWidthPx: () => (over.charWpx === undefined ? 160 : over.charWpx),
      setBodyYaw,
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
    getFallConfig: () => ({
      ...FALL_CFG,
      step_off_probability: over.stepOffProbability ?? 0,
    }),
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
    currentMotion: () => (motion === undefined ? { id: "idle", kind: "ambient" as const } : motion),
    isBusy: () => over.busy ?? false,
    reducedMotion: () => over.reducedMotion ?? false,
    onWalkStart: () => calls.push("avatar.walk_start"),
    onWalkEnd: () => calls.push("avatar.walk_end"),
    onWalkCancel,
    onSit: () => calls.push("avatar.window_sit"),
    onHostLost,
    onTargetLost,
    onTakeoff,
    onStepOff,
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
    onTakeoff,
    onStepOff,
    setBodyYaw,
    /** Arm a fresh commit-origin sit, the way a later drop release would. */
    rearm: () => {
      armed = true;
    },
    /** Hand the body to another clip, or back to the ambient baseline. */
    setMotion: (next: { id: string; kind: MotionKind | null } | null) => {
      motion = next;
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
    // A covering window is a jump candidate too, so the stroll's own draws are named
    // explicitly rather than left to fall wherever the jump's dice leave them.
    const h = makeHarness({
      windows: async () => [cover(1300, 300, 7), HOST],
      rng: seqRng(0, 1, 1),
    });
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
    const h = makeHarness({
      windows: async () => [HOST, cover(1300, 300, 7)],
      rng: seqRng(0, 1, 1, 0),
    });
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

  it("strolls a perch whose window origin hangs off the screen but whose feet do not", async () => {
    // Origin at −150 with the feet at 50, on a host reaching the work area's left edge.
    const h = makeHarness({
      windows: async () => [{ ...HOST, x: 0, width: 500 }],
      initialPos: { x: -150, y: 600 },
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledWith(200, expect.any(Function));
    expect(h.positions).toContainEqual({ x: -150, y: 480 });
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
      // Physical bounds twice the logical ones, so the scaled window is on the screen.
      monitors: async () => [
        {
          position: { x: 0, y: 0 },
          size: { width: 6000, height: 4000 },
          workArea: { position: { x: 0, y: 0 }, size: { width: 6000, height: 3800 } },
        },
      ],
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

  it("uses the existing exit path when a window is raised over the top under her feet", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST];
    const h = makeHarness({ walk: walking.promise, windows: async () => windows });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    // Her feet are at 1200, and this reaches across the host's top on either side of them.
    windows = [cover(1150, 200, 9), HOST];

    await h.frame(0.8);

    expect(h.walkerCancel).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.calls.slice(-3)).toEqual(["avatar.walk_end", "exit", "fall"]);
    expect(h.onHostLost).toHaveBeenCalledTimes(1);
  });

  it("uses the existing exit path when the leg ends with nothing under her feet", async () => {
    let reads = 0;
    // The host is there to plan the stroll against and gone by the time the leg ends.
    const h = makeHarness({ windows: async () => (++reads === 1 ? [HOST] : []) });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.onHostLost).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["suspend", "avatar.walk_start", "avatar.walk_end", "exit", "fall"]);
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
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // The host's right edge less the stroll's own margin, in window coordinates.
    expect(h.walkTo).toHaveBeenNthCalledWith(1, 1200, expect.any(Function));
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "jump",
      "abandon",
      "avatar.jump",
      "avatar.walk_end",
      "avatar.window_sit",
      "adopt",
    ]);
    expect(h.resumeSit).not.toHaveBeenCalled();
    // The posture leaves walking once per cycle, whatever the jump did on the way.
    expect(h.calls.filter((name) => name === "avatar.walk_end")).toHaveLength(1);
    // The landing leg walks on along the neighbour's own top before sitting down.
    expect(h.walkTo).toHaveBeenCalledTimes(2);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
    expect(h.release).not.toHaveBeenCalled();

    // The seat she landed on is a perch like any other: the dwell runs again on it.
    h.walkTo.mockClear();
    await h.frame(0.5);
    expect(h.walkTo).not.toHaveBeenCalled();
    await h.frame(0.6);
    expect(h.walkTo).toHaveBeenCalled();
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
      rng: () => 0,
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
      rng: () => 0,
      jump: Promise.resolve("lost"),
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "jump",
      "abandon",
      "avatar.jump",
      "avatar.walk_end",
      "target_lost",
    ]);
    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
    // She falls facing forward, not still turned a quarter into the jump.
    expect(h.setBodyYaw).toHaveBeenCalledWith(0, 400);
    expect(h.setBodyYaw.mock.invocationCallOrder[0]).toBeLessThan(
      h.onTargetLost.mock.invocationCallOrder[0],
    );
  });

  it("falls when the window she jumped onto is gone by the time she takes the seat", async () => {
    let reads = 0;
    const h = makeHarness({
      windows: async () => {
        reads++;
        return reads === 1 ? [HOST, NEIGHBOUR] : [HOST];
      },
      jumpProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "jump",
      "abandon",
      "avatar.jump",
      "avatar.walk_end",
      "target_lost",
    ]);
    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.setBodyYaw).toHaveBeenLastCalledWith(0, 400);
  });

  it("posts the walk she did not need, so a jump from the spot still reads as walking", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      rng: () => 0,
      arrivedInPlace: true,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // The walker had nothing to do, so the takeoff is what opens the walk cue.
    expect(h.calls).toEqual([
      "suspend",
      "jump",
      "avatar.walk_start",
      "abandon",
      "avatar.jump",
      "avatar.walk_end",
      "avatar.window_sit",
      "adopt",
    ]);
  });

  it("re-sits on the host when the jump is refused before she leaves the ground", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      rng: () => 0,
      jumpOutcome: "refused",
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
    expect(h.abandonSit).not.toHaveBeenCalled();
    expect(h.onTargetLost).not.toHaveBeenCalled();
    expect(h.onTakeoff).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();

    // The attempt settled, so the loop is free to try again on the next dwell.
    h.walkTo.mockClear();
    await h.frame(1.1);
    expect(h.walkTo).toHaveBeenCalled();
  });

  it("faces forward again when the landing leaves no room to walk on", async () => {
    // Too narrow a neighbour for a landing leg, so nothing else squares her up.
    const narrow = { ...NEIGHBOUR, width: 250 };
    const h = makeHarness({
      windows: async () => [HOST, narrow],
      jumpProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledTimes(1);
    expect(h.setBodyYaw).toHaveBeenLastCalledWith(0, 400);
    expect(h.adoptSit).toHaveBeenCalled();
  });

  it("bounds the landing leg by the stack as it is when she lands, not as it was", async () => {
    // A window slides over the neighbour's top while she is walking to the takeoff edge,
    // leaving no room for the landing leg the pre-takeoff stack would have allowed.
    let reads = 0;
    const h = makeHarness({
      windows: async () => {
        reads++;
        return reads === 1 ? [HOST, NEIGHBOUR] : [cover(1800, 400, 9), HOST, NEIGHBOUR];
      },
      jumpProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(reads).toBeGreaterThan(1);
    expect(h.walkTo).toHaveBeenCalledTimes(1);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
  });

  it("seats her on a landing planted a jump margin inside the target's stretch", async () => {
    // A window in front seams the neighbour's top at 1600, so the jump plans its landing at
    // 1700 — the margin it walks by (100), less than the room a fall wants (120).
    const front: WindowRect = {
      ...HOST,
      x: 1500,
      y: 600,
      width: 100,
      height: 400,
      name: "Cover",
      windowNumber: 9,
    };
    const h = makeHarness({
      windows: async () => [front, HOST, NEIGHBOUR],
      charWpx: 240,
      jumpProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.onTargetLost).not.toHaveBeenCalled();
    expect(h.calls).not.toContain("target_lost");
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
  });

  it("sits her down where a landing leg that never arrived left her", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      rng: () => 0,
      legWalk: "lost",
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // She is on the target's top either way, and the seat comes from where she stopped —
    // leaving her standing there would strand her with nothing scheduled.
    expect(h.walkTo).toHaveBeenCalledTimes(2);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
    expect(h.calls).toContain("avatar.window_sit");
    expect(h.calls.filter((name) => name === "avatar.walk_end")).toHaveLength(1);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.setBodyYaw).toHaveBeenLastCalledWith(0, 400);
  });

  it("skips a neighbour standing on whose top the work area would clamp", async () => {
    // The work area starts at y 480, which the host's own top clears exactly; standing on
    // a neighbour whose top is a hundred px higher would be clamped.
    const h = makeHarness({
      windows: async () => [HOST, { ...NEIGHBOUR, y: 800 }],
      monitors: async () => [
        {
          ...MONITOR,
          workArea: { position: { x: 0, y: 480 }, size: { width: 3000, height: 1420 } },
        },
      ],
      jumpProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.jump).not.toHaveBeenCalled();
    expect(h.resumeSit).toHaveBeenCalledTimes(1);
  });

  it("faces forward again when the jump is refused", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      rng: () => 0,
      jumpOutcome: "refused",
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.setBodyYaw).toHaveBeenCalledWith(0, 400);
    expect(h.resumeSit).toHaveBeenCalledTimes(1);
  });

  it("does not watch the host she has left, so its closing announces nothing", async () => {
    const flight = deferred<JumpOutcome>();
    let windows = [HOST, NEIGHBOUR];
    const h = makeHarness({
      windows: async () => windows,
      jumpProbability: 1,
      rng: () => 0,
      jump: flight.promise,
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    // The host she jumped off closes while she is still in the air.
    windows = [NEIGHBOUR];

    await h.frame(0.8);
    await h.frame(0.8);

    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();
    expect(h.calls).not.toContain("exit");

    flight.resolve("landed");
    await h.frame();
    expect(h.calls.filter((name) => name === "avatar.walk_end")).toHaveLength(1);
  });

  it("closes the walk cue when a pickup catches her mid-air", async () => {
    const flight = deferred<JumpOutcome>();
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      rng: () => 0,
      jump: flight.promise,
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    const before = [...h.calls];

    h.percher.cancel();
    expect(h.jumperCancel).toHaveBeenCalledTimes(1);
    // Nothing watches the host through the arc, so the cue is the only thing that can
    // leave the posture walking and the hit test in per-tick mode.
    expect(h.onWalkCancel).toHaveBeenCalledTimes(1);

    flight.resolve("cancelled");
    await h.frame();

    expect(h.calls).toEqual([...before, "avatar.walk_cancel"]);
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.onTargetLost).not.toHaveBeenCalled();
  });

  it("stays quiet when a jump she did not walk to is refused", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      jumpProbability: 1,
      rng: () => 0,
      arrivedInPlace: true,
      jumpOutcome: "refused",
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // No walk and no jump happened, so no walk cue is owed for either.
    expect(h.calls).toEqual(["suspend", "resume", "avatar.window_sit"]);
  });

  it("walks off the nearer edge and hands her to the fall when the roll comes up", async () => {
    const h = makeHarness({ stepOffProbability: 1, rng: () => 0 });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // The host's left edge is the nearer one; she stops a standing width past it.
    expect(h.walkTo).toHaveBeenCalledWith(720, expect.any(Function));
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "abandon",
      "avatar.walk_end",
      "step_off",
    ]);
    expect(h.onStepOff).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
  });

  it("steps off a ledge that leaves no room to stroll", async () => {
    const narrow = { ...HOST, x: 1095, width: 210 };
    const h = makeHarness({
      windows: async () => [narrow],
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // Both edges sit 105 px away, and the tie goes to the draw.
    expect(h.walkTo).toHaveBeenCalledWith(815, expect.any(Function));
    expect(h.onStepOff).toHaveBeenCalledTimes(1);
  });

  it("steps off the far edge when the nearer one is past the work area", async () => {
    // Perched at the right end of a window that reaches the work area's right edge.
    const h = makeHarness({
      windows: async () => [{ ...HOST, x: 2000, width: 1000 }],
      initialPos: { x: 2700, y: 600 },
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledWith(1720, expect.any(Function));
    expect(h.onStepOff).toHaveBeenCalledTimes(1);
  });

  it("strolls instead when neither edge leads anywhere inside the work area", async () => {
    const h = makeHarness({
      windows: async () => [{ ...HOST, x: 0, width: 3000 }],
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledWith(920, expect.any(Function));
    expect(h.onStepOff).not.toHaveBeenCalled();
    expect(h.resumeSit).toHaveBeenCalledTimes(1);
  });

  it("strolls as usual when a neighbour she could jump to leaves the roll unrolled", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.onStepOff).not.toHaveBeenCalled();
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
  });

  it("re-sits when the step-off leg never gets going", async () => {
    const h = makeHarness({ stepOffProbability: 1, rng: () => 0, walkAccepted: false });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.onStepOff).not.toHaveBeenCalled();
    expect(h.resumeSit).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["suspend", "resume", "avatar.window_sit"]);
  });

  it("keeps the step-off going while her feet are out past the edge", async () => {
    const walking = deferred<"arrived" | "lost">();
    const h = makeHarness({
      walk: walking.promise,
      walkMovesTo: { y: 480 },
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);

    // Her feet are at 920, a standing width past the host's left edge, which is the whole
    // point of the leg — the polls that run out there have nothing to find under them.
    await h.frame(0.8);
    await h.frame(0.8);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();

    walking.resolve("arrived");
    await h.frame();

    expect(h.onStepOff).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();
  });

  it("re-sits when the step-off leg is lost after her feet have left the edge", async () => {
    const h = makeHarness({
      walk: Promise.resolve("lost"),
      walkMovesTo: { y: 480 },
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.onStepOff).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
  });

  it("sits on the level neighbour her leg carried her onto", async () => {
    const h = makeHarness({
      windows: async () => [HOST, LEDGE],
      walkMovesTo: { y: 480 },
      rng: seqRng(0, 1, 1, 1),
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // The leg reaches 1600, which is 100 px past the seam at the host's right edge.
    expect(h.walkTo).toHaveBeenCalledWith(1400, expect.any(Function));
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "abandon",
      "avatar.window_sit",
      "adopt",
    ]);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1500, y: 900 }, 500, "commit");
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();

    // The seat across the seam is a perch like any other: the dwell runs on it.
    h.walkTo.mockClear();
    await h.frame(0.5);
    expect(h.walkTo).not.toHaveBeenCalled();
    await h.frame(2);
    expect(h.walkTo).toHaveBeenCalled();
  });

  it("sits back on the host when the leg stops short of the seam", async () => {
    const h = makeHarness({
      windows: async () => [HOST, LEDGE],
      walkMovesTo: { y: 480 },
      rng: seqRng(0, 1, 0, 1),
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    expect(h.walkTo).toHaveBeenCalledWith(1080, expect.any(Function));
    expect(h.calls).toEqual([
      "suspend",
      "avatar.walk_start",
      "avatar.walk_end",
      "resume",
      "avatar.window_sit",
    ]);
    expect(h.adoptSit).not.toHaveBeenCalled();
  });

  it("stays put when the far end of the ledge closes under her feet on the host", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST, LEDGE];
    const h = makeHarness({
      walk: walking.promise,
      windows: async () => windows,
      rng: seqRng(0, 1, 1, 1),
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    windows = [HOST];

    await h.frame(0.8);
    await h.frame(0.8);

    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();
  });

  it("stays put when the host closes after her feet have crossed the seam", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST, LEDGE];
    const h = makeHarness({
      walk: walking.promise,
      walkMovesTo: { y: 480 },
      windows: async () => windows,
      rng: seqRng(0, 1, 1, 1),
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    windows = [LEDGE];

    await h.frame(0.8);
    await h.frame(0.8);

    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();
  });

  it("falls when the ledge window under her feet goes", async () => {
    const walking = deferred<"arrived" | "lost">();
    let windows = [HOST, LEDGE];
    const h = makeHarness({
      walk: walking.promise,
      walkMovesTo: { y: 480 },
      windows: async () => windows,
      rng: seqRng(0, 1, 1, 1),
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);
    windows = [HOST];

    await h.frame(0.8);

    expect(h.walkerCancel).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.calls.slice(-3)).toEqual(["avatar.walk_end", "exit", "fall"]);
    expect(h.onHostLost).toHaveBeenCalledTimes(1);
  });

  it("drops the suspension when a pickup catches her mid-crossing", async () => {
    const walking = deferred<"arrived" | "lost">();
    const h = makeHarness({
      walk: walking.promise,
      walkMovesTo: { y: 480 },
      windows: async () => [HOST, LEDGE],
      rng: seqRng(0, 1, 1, 1),
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);

    h.percher.cancel();
    expect(h.walkerCancel).toHaveBeenCalledTimes(1);
    expect(h.onWalkCancel).toHaveBeenCalledTimes(1);
    expect(h.abandonSit).toHaveBeenCalledTimes(1);

    walking.resolve("arrived");
    await h.frame();

    expect(h.resumeSit).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
  });

  it("steps off the outer end of the ledge, not the host's own edge", async () => {
    const h = makeHarness({
      windows: async () => [HOST, LEDGE],
      initialPos: { x: 1200, y: 600 },
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();

    await h.frame();
    await h.frame(1.1);

    // The ledge's left end is 400 px away and the host's right edge only 100, so the
    // nearer edge is the one the ledge's far end puts there.
    expect(h.walkTo).toHaveBeenCalledWith(720, expect.any(Function));
    expect(h.onStepOff).toHaveBeenCalledTimes(1);
  });

  it("keeps the ledge step-off going while her feet are out past its outer end", async () => {
    const walking = deferred<"arrived" | "lost">();
    const h = makeHarness({
      walk: walking.promise,
      walkMovesTo: { y: 480 },
      windows: async () => [HOST, LEDGE],
      initialPos: { x: 1200, y: 600 },
      stepOffProbability: 1,
      rng: () => 0,
    });
    h.percher.start();
    await h.frame();
    await h.frame(1.1);

    // Neither of the ledge's two windows reaches 920, where her feet now are.
    await h.frame(0.8);
    await h.frame(0.8);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.onHostLost).not.toHaveBeenCalled();

    walking.resolve("arrived");
    await h.frame();

    expect(h.onStepOff).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
  });

  it("takes the seat on the window a fall came down on", async () => {
    // Standing on the neighbour's top edge at x 1700, where the fall left her.
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      initialPos: { x: 1500, y: 480 },
      armed: false,
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();

    expect(h.walkTo).toHaveBeenCalledWith(1580, expect.any(Function));
    expect(h.calls).toEqual(["avatar.walk_start", "avatar.walk_end", "avatar.window_sit", "adopt"]);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
    expect(h.setBodyYaw).toHaveBeenLastCalledWith(0, 400);
    expect(h.release).not.toHaveBeenCalled();

    // The seat she landed on is a perch like any other: the dwell runs on it.
    h.walkTo.mockClear();
    await h.frame(0.5);
    expect(h.walkTo).not.toHaveBeenCalled();
    await h.frame(2);
    expect(h.walkTo).toHaveBeenCalled();
  });

  it("keeps a landing whose body reads are not ready and takes it on the next tick", async () => {
    let reads = 0;
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      initialPos: { x: 1500, y: 480 },
      armed: false,
      anchor: () => (++reads === 1 ? null : { x: 200, y: 420 }),
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();
    expect(h.adoptSit).not.toHaveBeenCalled();

    await h.frame();

    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
  });

  it("takes the seat without a walk when the user asked for no motion", async () => {
    const h = makeHarness({
      windows: async () => [HOST, NEIGHBOUR],
      initialPos: { x: 1500, y: 480 },
      armed: false,
      reducedMotion: true,
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();

    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["avatar.window_sit", "adopt"]);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
  });

  it("waits for the touchdown clip to give the body back before taking the seat", async () => {
    const h = makeHarness({
      windows: async () => [NEIGHBOUR],
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();
    await h.frame();
    expect(h.walkTo).not.toHaveBeenCalled();

    h.setMotion({ id: "idle", kind: "ambient" });
    await h.frame();

    expect(h.walkTo).toHaveBeenCalledTimes(1);
    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
  });

  it("falls again when the window she landed on has gone by the time it reads", async () => {
    const h = makeHarness({
      windows: async () => [],
      initialPos: { x: 1500, y: 480 },
      armed: false,
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();

    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["target_lost"]);
    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
  });

  it("falls again when the window she landed on slid away before the seat was taken", async () => {
    const h = makeHarness({
      windows: async () => [{ ...NEIGHBOUR, x: NEIGHBOUR.x + 40 }],
      initialPos: { x: 1500, y: 480 },
      armed: false,
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();

    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
  });

  it("takes the seat from the rect the fresh stack gives, not the one she came down on", async () => {
    // A nudge inside MOVE_TH is the same window, in the place it is in now.
    const h = makeHarness({
      windows: async () => [HOST, { ...NEIGHBOUR, x: NEIGHBOUR.x + 5 }],
      initialPos: { x: 1500, y: 480 },
      armed: false,
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();

    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1565, y: 900 }, 500, "commit");
    expect(h.onTargetLost).not.toHaveBeenCalled();
  });

  it("falls out of a pending landing when its window closes during the touchdown clip", async () => {
    let stack = [NEIGHBOUR];
    const h = makeHarness({
      windows: async () => stack,
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame(0.4);
    expect(h.onTargetLost).not.toHaveBeenCalled();
    stack = [];
    await h.frame(0.4);

    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
    // The landing is dropped with it: the body coming back changes nothing.
    h.setMotion({ id: "idle", kind: "ambient" });
    await h.frame();
    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();
  });

  it("falls out of a pending landing when its window is dragged away", async () => {
    let stack = [NEIGHBOUR];
    const h = makeHarness({
      windows: async () => stack,
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    stack = [{ ...NEIGHBOUR, x: NEIGHBOUR.x + 20 }];
    await h.frame(0.8);

    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
  });

  it("falls out of a pending landing when a window comes up over her feet", async () => {
    let stack: WindowRect[] = [NEIGHBOUR];
    const h = makeHarness({
      windows: async () => stack,
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    // The cover reaches across her feet at 1700, so nothing of the target is under them.
    stack = [cover(1650, 300, 9), NEIGHBOUR];
    await h.frame(0.8);

    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending landing when the window in front stops short of her feet", async () => {
    let stack: WindowRect[] = [NEIGHBOUR];
    const h = makeHarness({
      windows: async () => stack,
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    // Its near edge is at 1800, clear of her feet at 1700.
    stack = [cover(1800, 200, 9), NEIGHBOUR];
    await h.frame(0.8);
    expect(h.onTargetLost).not.toHaveBeenCalled();

    h.setMotion({ id: "idle", kind: "ambient" });
    await h.frame();

    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1560, y: 900 }, 500, "commit");
  });

  it("falls again when the window she landed on is covered by the time it reads", async () => {
    const h = makeHarness({
      windows: async () => [cover(1650, 300, 9), NEIGHBOUR],
      initialPos: { x: 1500, y: 480 },
      armed: false,
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    await h.frame();

    expect(h.adoptSit).not.toHaveBeenCalled();
    expect(h.onTargetLost).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending landing whose window barely moved and seats her on it", async () => {
    let stack = [HOST, NEIGHBOUR];
    const h = makeHarness({
      windows: async () => stack,
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    stack = [HOST, { ...NEIGHBOUR, x: NEIGHBOUR.x + 5 }];
    await h.frame(0.8);
    expect(h.onTargetLost).not.toHaveBeenCalled();

    h.setMotion({ id: "idle", kind: "ambient" });
    await h.frame();

    expect(h.adoptSit).toHaveBeenCalledWith(7, { x: 1565, y: 900 }, 500, "commit");
  });

  it("watches a pending landing on the poll cadence, one read at a time", async () => {
    const pending = deferred<WindowRect[]>();
    let reads = 0;
    const h = makeHarness({
      windows: () => {
        reads++;
        return reads === 1 ? Promise.resolve([NEIGHBOUR]) : pending.promise;
      },
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "landing", kind: "oneshot" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    // Two seconds of frames against a 700 ms cadence: two reads, not twenty.
    for (let i = 0; i < 20; i++) await h.frame(0.1);
    expect(reads).toBe(2);

    // The second never came back, so the cadence issues nothing on top of it.
    await h.frame(0.8);
    await h.frame(0.8);
    expect(reads).toBe(2);
  });

  it("drops a pending landing when the user picks her up first", async () => {
    const h = makeHarness({
      windows: async () => [NEIGHBOUR],
      initialPos: { x: 1500, y: 480 },
      armed: false,
      motion: { id: "drag", kind: "reactive" },
    });
    h.percher.start();

    h.percher.landOn(NEIGHBOUR);
    h.percher.cancel();
    h.setMotion({ id: "idle", kind: "ambient" });
    await h.frame();

    expect(h.walkTo).not.toHaveBeenCalled();
    expect(h.adoptSit).not.toHaveBeenCalled();
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
