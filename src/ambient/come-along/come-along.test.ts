import { describe, expect, it, vi } from "vitest";
import { avatarFixture } from "../../config/load-test-helpers";
import type { StageSlot } from "../../io/bridge/settings-bridge";
import type { ScreenMonitor } from "../../io/window/geometry/screen-geometry";
import type { Renderer } from "../../renderer";
import type { HoldOptions } from "../locomotion/hold/holds";
import { type ComeAlongDeps, createComeAlong } from "./come-along";

// One 1920 × 900 pt monitor at scale 2, its work area ending at 875 pt.
const monitor: ScreenMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 3840, height: 1800 },
  workArea: { position: { x: 0, y: 50 }, size: { width: 3840, height: 1700 } },
  scaleFactor: 2,
};
// The slot is 400 × 600 pt, so her 400 × 600 window docks at the slot's own origin, (100, 80).
const slot: StageSlot = { x: 100, y: 80, width: 400, height: 600, scale: 2 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness(
  opts: {
    at?: { x: number; y: number };
    native?: boolean;
    /** Follows a settings window it is not linked to in physical px, as on Windows. */
    physicalFollow?: boolean;
    storage?: Storage;
    /** Her feet's y in her window, logical, by default at its bottom; null with no VRM loaded. */
    feet?: number | null;
    /** The last backend emotion, by default neutral. */
    emotion?: string;
    /** What the stay roll and the entry pick draw, in [0, 1). */
    roll?: number;
    /** Her on-screen height in px; null with no probe. */
    charHpx?: number | null;
    /** Whether the renderer accepts a stage peek pin. */
    pinAccepted?: boolean;
  } = {},
) {
  // Her window in logical points; the fakes answer in physical px at scale 2.
  const real = { x: opts.at?.x ?? 1300, y: opts.at?.y ?? 80, width: 400, height: 600 };
  const scale = 2;
  const ticks = new Set<(ctx: { dt: number }) => void>();
  const walked: Array<[number, number]> = [];
  /** Her real window's moves and her canvas's vanish, land and appear, in order. */
  const events: string[] = [];
  const travels: Array<{ end: ReturnType<typeof vi.fn> }> = [];
  let virtual = { x: real.x, y: real.y };
  let busy = false;
  let travelling = false;
  const frameWindow = {
    outerPosition: async () => ({ x: real.x * scale, y: real.y * scale }),
    outerSize: async () => ({ width: real.width * scale, height: real.height * scale }),
    scaleFactor: async () => scale,
    setPositionLogical: vi.fn(async (x: number, y: number) => {
      events.push(`move ${x},${y}`);
      real.x = x;
      real.y = y;
    }),
    setFrameLogical: vi.fn(async () => {}),
  };
  const locomotion = {
    hold: vi.fn<(holder: "come-along", on: boolean, opts?: HoldOptions) => void>(),
    abortTravel: vi.fn(async () => {}),
    widen: vi.fn(async (_via: Array<{ x: number; y: number }>) => {
      virtual = { x: real.x, y: real.y };
      const end = vi.fn(async () => {
        real.x = virtual.x;
        real.y = virtual.y;
      });
      travels.push({ end });
      return {
        win: {
          ...frameWindow,
          setPositionLogical: async (x: number, y: number) => {
            virtual = { x, y };
            walked.push([x, y]);
          },
        },
        end,
      };
    }),
    release: vi.fn(),
    drop: vi.fn(async (_opts: { landOnSeam: true }) => {}),
    isTravelling: () => travelling,
    frame: { frameWindow: () => frameWindow, listMonitors: async () => [monitor] },
  };
  const dock = {
    attach: vi.fn(async () => opts.native ?? true),
    detach: vi.fn(async () => {}),
  };
  const setPositionPhysical = vi.fn(async (_x: number, _y: number) => {});
  /** The motion the renderer plays now, and its play time (s). */
  let current = "idle";
  let motionTime: number | null = 0;
  const playMotion = vi.fn<Renderer["playMotion"]>((motion) => {
    current = motion?.id ?? "idle";
  });
  const setPeekTarget = vi.fn<Renderer["setPeekTarget"]>((target) => {
    if (target) events.push(`pin ${target.targetXpx}`);
    return opts.pinAccepted ?? true;
  });
  const setMotionMirror = vi.fn<Renderer["setMotionMirror"]>();
  const setBodyYaw = vi.fn<Renderer["setBodyYaw"]>();
  const vanish = vi.fn(async () => {
    events.push("vanish");
  });
  let reduced = false;
  // Her yaw is watched, though she never turns while carried.
  const renderer: ComeAlongDeps["renderer"] & Pick<Renderer, "setBodyYaw"> = {
    onTick: (fn) => {
      const cb = fn as (ctx: { dt: number }) => void;
      ticks.add(cb);
      return () => ticks.delete(cb);
    },
    playMotion,
    getCurrentMotion: () => ({ id: current, vrma_path: "" }),
    getCurrentMotionTime: () => motionTime,
    setBodyYaw,
    setPeekTarget,
    setMotionMirror,
    getPerchProbe: () =>
      opts.charHpx === null ? null : { seatPx: { x: 200, y: 300 }, charHpx: opts.charHpx ?? 500 },
    getCharacterAnchor: () => {
      const feet = opts.feet === undefined ? real.height : opts.feet;
      return feet === null ? null : { x: 200, y: feet };
    },
    vanish,
    land: async (origin) => {
      events.push(`land ${JSON.stringify(origin)}`);
    },
    appear: async () => {
      events.push("appear");
    },
  };
  const comeAlong = createComeAlong({
    settingsLabel: "settings",
    storage: opts.storage ?? fakeStorage(),
    isBusy: () => busy,
    peek: { active: () => false, exit: async () => {} },
    locomotion,
    renderer,
    hitTest: { setMoving: vi.fn() },
    dock,
    setPositionPhysical,
    followsInPhysicalPx: opts.physicalFollow ?? false,
    reducedMotion: () => reduced,
    stage: () => avatarFixture().stage,
    // The fixture's stage.emotion_decay_min is 30.
    lastEmotion: (decayMs) => (decayMs === 30 * 60_000 ? (opts.emotion ?? "neutral") : "neutral"),
    random: () => opts.roll ?? 0,
  });
  const tick = (ms: number) => {
    for (const cb of [...ticks]) cb({ dt: ms / 1000 });
  };
  /** Ticks in 10 ms frames until nothing listens, then lets the walk settle. */
  /** Ticks in 10 ms frames until `step` settles, however she travels. */
  const finish = async (step: Promise<void>) => {
    let settled = false;
    const settle = () => {
      settled = true;
    };
    step.then(settle, settle);
    while (!settled) {
      tick(10);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await step;
  };
  /** An agent move, or a user drag, takes her from the come-along's hold. */
  const abort = (by: "agent" | "drag" = "agent") =>
    locomotion.hold.mock.calls.findLast(([, on]) => on)?.[2]?.onAbort?.(by);
  /** Waits for her pickup and ticks through its 200 ms hold. */
  const pickUp = async () => {
    await vi.waitFor(() => expect(ticks.size).toBe(1));
    tick(200);
  };
  return {
    comeAlong,
    real,
    walked,
    events,
    vanish,
    playMotion,
    setPeekTarget,
    setMotionMirror,
    setBodyYaw,
    pickUp,
    setCurrent: (id: string) => {
      current = id;
    },
    setMotionTime: (s: number | null) => {
      motionTime = s;
    },
    finish,
    travels,
    ticks,
    tick,
    abort,
    locomotion,
    dock,
    frameWindow,
    setPositionPhysical,
    setBusy: (on: boolean) => {
      busy = on;
    },
    setReduced: (on: boolean) => {
      reduced = on;
    },
    setTravelling: (on: boolean) => {
      travelling = on;
    },
  };
}

function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    },
  };
}

/** Docks her from (1300, 80) onto `slot` and returns the harness. */
async function docked(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts);
  await h.finish(h.comeAlong.onStage(slot));
  return h;
}

describe("createComeAlong", () => {
  it("picks her up, holds still, carries her slow, then fast, then slow facing front, and docks", async () => {
    const h = harness();
    const done = h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.ticks.size).toBe(1));

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }]]);
    h.tick(199);
    expect(h.walked).toEqual([]);
    h.tick(1);
    await vi.waitFor(() => expect(h.ticks.size).toBe(1));
    // 1200 pt to go takes 900 ms: 10%, 50% and 90% of it, then the end.
    for (const ms of [90, 360, 360, 90]) h.tick(ms);
    await done;

    expect(h.setBodyYaw).not.toHaveBeenCalled();
    expect(h.locomotion.widen).toHaveBeenCalledExactlyOnceWith([{ x: 100, y: 80 }]);
    expect(h.walked).toEqual([
      [1295, 80],
      [700, 80],
      [105, 80],
      [100, 80],
    ]);
    expect([h.real.x, h.real.y]).toEqual([100, 80]);
    expect(h.dock.attach).toHaveBeenCalledOnce();
  });

  it.each([
    [1300, 900],
    [400, 675],
  ])("carries her from x %d onto the slot in %d ms after the hold", async (x, ms) => {
    const h = harness({ at: { x, y: 80 } });
    const done = h.comeAlong.onStage(slot);
    await h.pickUp();
    await vi.waitFor(() => expect(h.ticks.size).toBe(1));

    h.tick(ms - 1);
    expect(h.ticks.size).toBe(1);
    h.tick(1);
    await done;

    expect(h.ticks.size).toBe(0);
    expect(h.dock.attach).toHaveBeenCalledOnce();
  });

  it("fades out and in under reduced motion, picking nothing up", async () => {
    const h = harness();
    h.setReduced(true);

    await h.comeAlong.onStage(slot);

    expect(h.locomotion.widen).not.toHaveBeenCalled();
    expect(h.events).toEqual(["vanish", "move 100,80", "appear"]);
    expect(h.playMotion).not.toHaveBeenCalledWith({ id: "drag" });
    expect(h.dock.attach).toHaveBeenCalledOnce();
  });

  it("picks her up and holds still before she vanishes", async () => {
    const h = harness({ at: { x: 1500, y: 80 } });
    const done = h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.ticks.size).toBe(1));

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }]]);
    h.tick(199);
    expect(h.vanish).not.toHaveBeenCalled();
    h.tick(1);
    await done;

    expect(h.events).toEqual(["vanish", "move 100,80", 'land {"x":200,"y":600}']);
  });

  it.each([
    ["over 1200 pt on her monitor", { x: 1500, y: 80 }],
    ["from a spot on no monitor", { x: 100, y: 700 }],
  ])("vanishes and lands on the slot %s", async (_, at) => {
    const h = harness({ at });

    await h.finish(h.comeAlong.onStage(slot));

    expect(h.locomotion.widen).not.toHaveBeenCalled();
    expect(h.events).toEqual(["vanish", "move 100,80", 'land {"x":200,"y":600}']);
    expect(h.dock.attach).toHaveBeenCalledOnce();
  });

  it("vanishes and fades in on the slot when no VRM gives her feet", async () => {
    const h = harness({ at: { x: 1500, y: 80 }, feet: null });

    await h.finish(h.comeAlong.onStage(slot));

    expect(h.events).toEqual(["vanish", "move 100,80", "appear"]);
  });

  it("shows her again when a drag takes her mid-vanish", async () => {
    const h = harness({ at: { x: 1500, y: 80 } });
    const vanished = deferred<void>();
    h.vanish.mockImplementationOnce(() => {
      h.events.push("vanish");
      return vanished.promise;
    });
    const done = h.comeAlong.onStage(slot);
    await h.pickUp();
    await vi.waitFor(() => expect(h.vanish).toHaveBeenCalledOnce());

    await h.abort();
    vanished.resolve();
    await done;

    expect(h.events).toEqual(["vanish", "appear"]);
    expect(h.dock.attach).not.toHaveBeenCalled();
  });

  it("leaves her to the newer move when the window closes and reopens mid-vanish", async () => {
    const h = harness({ at: { x: 1500, y: 80 } });
    const vanished = deferred<void>();
    h.vanish.mockImplementationOnce(() => {
      h.events.push("vanish");
      return vanished.promise;
    });
    const first = h.comeAlong.onStage(slot);
    await h.pickUp();
    await vi.waitFor(() => expect(h.vanish).toHaveBeenCalledOnce());

    await h.comeAlong.onStage(null);
    const second = h.comeAlong.onStage(slot);
    await h.pickUp();
    await second;
    vanished.resolve();
    await first;

    expect(h.events).toEqual([
      "vanish",
      "move 1500,80",
      "appear",
      "vanish",
      "move 100,80",
      'land {"x":200,"y":600}',
    ]);
    expect(h.dock.attach).toHaveBeenCalledOnce();
  });

  it("shows her again when her window fails to move mid-vanish", async () => {
    const h = harness({ at: { x: 1500, y: 80 } });
    h.frameWindow.setPositionLogical.mockRejectedValueOnce(new Error("window gone"));

    await expect(h.finish(h.comeAlong.onStage(slot))).rejects.toThrow("window gone");

    expect(h.events).toEqual(["vanish", "appear"]);
  });

  it("shows her before she walks home when the window closes mid-vanish", async () => {
    // From a spot on no monitor; her home is then the floor 195 pt below the slot.
    const h = harness({ at: { x: 100, y: 700 } });
    const moving = deferred<void>();
    h.frameWindow.setPositionLogical.mockImplementationOnce(async (x, y) => {
      Object.assign(h.real, { x, y });
      return moving.promise;
    });
    const first = h.comeAlong.onStage(slot);
    await h.pickUp();
    await vi.waitFor(() => expect(h.frameWindow.setPositionLogical).toHaveBeenCalledOnce());

    const home = h.comeAlong.onStage(null);
    await vi.waitFor(() => expect(h.locomotion.widen).toHaveBeenCalledOnce());

    expect(h.events).toEqual(["vanish", "appear"]);
    await h.finish(home);
    moving.resolve();
    await first;
  });

  it.each([
    [560, 120],
    [null, 80],
  ])("stands her feet at %j in her window on the slot's bottom edge, at y %d", async (feet, y) => {
    const h = harness({ feet });
    h.setReduced(true);

    await h.comeAlong.onStage(slot);

    expect(h.frameWindow.setPositionLogical).toHaveBeenCalledExactlyOnceWith(100, y);
  });

  it("holds her, leaves her seat and lets a running travel end before she leaves", async () => {
    const h = await docked();

    expect(h.locomotion.hold).toHaveBeenCalledWith("come-along", true, {
      onAbort: expect.any(Function),
      endsOnDrag: true,
      keepsGeometry: true,
      pausesKeepOnScreen: true,
    });
    expect(h.locomotion.release).toHaveBeenCalledOnce();
    expect(h.locomotion.abortTravel.mock.invocationCallOrder[0]).toBeLessThan(
      h.locomotion.widen.mock.invocationCallOrder[0]!,
    );
  });

  it("goes home on a null slot: undocks, carries her back to her spot, idles with no clip, lets go and drops", async () => {
    const h = await docked();
    h.playMotion.mockClear();

    await h.finish(h.comeAlong.onStage(null));

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [null]]);
    expect(h.playMotion.mock.invocationCallOrder[1]).toBeLessThan(
      h.locomotion.drop.mock.invocationCallOrder[0]!,
    );
    expect(h.dock.detach).toHaveBeenCalledOnce();
    expect(h.locomotion.widen).toHaveBeenLastCalledWith([{ x: 1300, y: 80 }]);
    expect([h.real.x, h.real.y]).toEqual([1300, 80]);
    expect(h.locomotion.hold).toHaveBeenLastCalledWith("come-along", false);
    expect(h.locomotion.drop).toHaveBeenCalledExactlyOnceWith({ landOnSeam: true });
  });

  it("lets go when the window minimises before she has left her spot", async () => {
    const h = harness();
    const ended = deferred<void>();
    h.locomotion.abortTravel.mockReturnValueOnce(ended.promise);
    const done = h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.locomotion.abortTravel).toHaveBeenCalledOnce());

    await h.comeAlong.onStage(null);
    ended.resolve();
    await done;

    expect(h.locomotion.hold).toHaveBeenLastCalledWith("come-along", false);
    expect(h.locomotion.widen).not.toHaveBeenCalled();
  });

  it("judges her spot gone by the size she left it at, not a size she took on the stage", async () => {
    const h = await docked();
    // On the stage her window grew; with this size her spot's centre would sit below the monitor.
    Object.assign(h.real, { width: 800, height: 1800 });

    await h.finish(h.comeAlong.goHome());

    expect([h.real.x, h.real.y]).toEqual([1300, 80]);
  });

  it.each([
    ["right of every monitor", { x: 2000, y: 300 }, [1520, 275]],
    ["above and left of every monitor", { x: -900, y: -800 }, [0, 275]],
  ])("goes home to the nearest floor when her spot is %s", async (_, at, home) => {
    const h = await docked({ at });

    await h.finish(h.comeAlong.goHome());

    expect([h.real.x, h.real.y]).toEqual(home);
  });

  it("follows each slot in the settings window's physical px when the shell links nothing on Windows", async () => {
    const h = await docked({ native: false, physicalFollow: true });

    await h.comeAlong.onStage({ x: 300, y: 100, width: 400, height: 600, scale: 1.5 });

    // Her 400 × 600 pt window docks at (300, 100) pt, which is (450, 150) px at the slot's scale 1.5.
    expect(h.setPositionPhysical).toHaveBeenCalledExactlyOnceWith(450, 150);
  });

  it("follows each slot in logical points when the shell links nothing on macOS", async () => {
    const h = await docked({ native: false });
    h.frameWindow.setPositionLogical.mockClear();

    await h.comeAlong.onStage({ x: 300, y: 100, width: 400, height: 600, scale: 1.5 });

    expect(h.frameWindow.setPositionLogical).toHaveBeenCalledExactlyOnceWith(300, 100);
    expect(h.setPositionPhysical).not.toHaveBeenCalled();
  });

  it("natively docked, places her only when the slot moved away from her", async () => {
    const h = await docked();
    h.frameWindow.setPositionLogical.mockClear();

    await h.comeAlong.onStage(slot);
    await h.comeAlong.onStage({ ...slot, y: 130 });

    expect(h.frameWindow.setPositionLogical.mock.calls).toEqual([[100, 130]]);
  });

  it("holds a slot back while a travel parks her frame, and places her on the newest one after", async () => {
    const h = await docked();
    h.frameWindow.setPositionLogical.mockClear();
    h.setTravelling(true);

    await h.comeAlong.onStage({ ...slot, y: 130 });
    await h.comeAlong.onStage({ ...slot, y: 160 });
    expect(h.frameWindow.setPositionLogical).not.toHaveBeenCalled();

    h.setTravelling(false);
    await h.comeAlong.place();
    expect(h.frameWindow.setPositionLogical.mock.calls).toEqual([[100, 160]]);
  });

  it("keeps her bottom-centre on the slot after her window is resized while docked", async () => {
    const h = await docked();
    Object.assign(h.real, { width: 480, height: 720 });

    await h.comeAlong.place();

    expect([h.real.x, h.real.y]).toEqual([60, -40]);
  });

  it("stays when a drag or an agent command runs at the open, until the window minimises", async () => {
    const h = harness();
    h.setBusy(true);
    await h.comeAlong.onStage(slot);
    h.setBusy(false);
    await h.comeAlong.onStage({ ...slot, x: 200 });

    expect(h.locomotion.hold).not.toHaveBeenCalled();

    await h.comeAlong.onStage(null);
    void h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.locomotion.widen).toHaveBeenCalledOnce());
  });

  it("lets go when a drag or an agent move takes her, and ignores the window until it minimises", async () => {
    const h = await docked();

    await h.abort();
    await h.comeAlong.onStage({ ...slot, y: 130 });
    await h.comeAlong.onStage(null);

    expect(h.dock.detach).toHaveBeenCalledOnce();
    expect(h.locomotion.hold).toHaveBeenLastCalledWith("come-along", false);
    expect(h.locomotion.widen).toHaveBeenCalledOnce();
    expect([h.real.x, h.real.y]).toEqual([100, 80]);

    await h.comeAlong.onStage(slot);
    expect(h.dock.attach).toHaveBeenCalledTimes(2);
  });

  it("stops her carry at once when a drag takes her mid-way: no frame is written after it", async () => {
    const h = harness();
    const done = h.comeAlong.onStage(slot);
    await h.pickUp();
    await vi.waitFor(() => expect(h.ticks.size).toBe(1));
    h.tick(90);

    const letGo = h.abort();
    expect(h.ticks.size).toBe(0);
    h.tick(360);
    await letGo;
    await done;

    expect(h.walked).toEqual([[1295, 80]]);
  });

  it("moves no real frame after an abort while the travel parks", async () => {
    const h = harness();
    const parked = deferred<Awaited<ReturnType<typeof h.locomotion.widen>>>();
    const widen = h.locomotion.widen.getMockImplementation()!;
    h.locomotion.widen.mockImplementationOnce(async (via) => {
      const travel = await widen(via);
      return parked.promise.then(() => travel);
    });
    const done = h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.locomotion.widen).toHaveBeenCalledOnce());

    await h.abort();
    parked.resolve(undefined as never);
    await done;

    expect(h.ticks.size).toBe(0);
    expect(h.walked).toEqual([]);
    expect(h.frameWindow.setPositionLogical).not.toHaveBeenCalled();
    expect(h.dock.attach).not.toHaveBeenCalled();
  });

  it("undocks at once when the attach resolves after an abort", async () => {
    const h = harness();
    h.setReduced(true);
    const attached = deferred<boolean>();
    h.dock.attach.mockReturnValueOnce(attached.promise);
    const done = h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.dock.attach).toHaveBeenCalledOnce());

    await h.abort();
    attached.resolve(true);
    await done;

    expect(h.dock.detach).toHaveBeenCalledOnce();
  });

  it("stays on the desktop and sulks when angry and the roll falls under stay_chance", async () => {
    const storage = fakeStorage();
    const h = harness({ emotion: "angry", roll: 0.59, storage });

    await h.finish(h.comeAlong.onStage(slot));

    expect(h.locomotion.widen).not.toHaveBeenCalled();
    expect(h.dock.attach).not.toHaveBeenCalled();
    expect(h.playMotion.mock.calls).toEqual([[{ id: "sulk" }]]);
    expect(storage.getItem("yui.come-along.settings")).toBe('{"stays":true}');
  });

  it("comes along and sulks on the stage when angry and the roll reaches stay_chance", async () => {
    const h = harness({ emotion: "angry", roll: 0.6 });

    await h.finish(h.comeAlong.onStage(slot));

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [{ id: "sulk" }]]);
    expect(h.dock.attach.mock.invocationCallOrder[0]).toBeLessThan(
      h.playMotion.mock.invocationCallOrder[1]!,
    );
  });

  it("plays one entry clip of her emotion's family once docked, never the family's last one", async () => {
    const h = await docked({ emotion: "sad" });

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [{ id: "yawn" }]]);
    expect(h.dock.attach.mock.invocationCallOrder[0]).toBeLessThan(
      h.playMotion.mock.invocationCallOrder[1]!,
    );

    await h.finish(h.comeAlong.onStage(null));
    h.playMotion.mockClear();
    await h.finish(h.comeAlong.onStage(slot));
    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [{ id: "idle_10" }]]);
  });

  it("records the entry clip only once it plays", async () => {
    const h = harness();
    const done = h.comeAlong.onStage(slot);
    await h.pickUp();
    await h.abort();
    await done;
    await h.comeAlong.onStage(null);
    h.playMotion.mockClear();

    await h.finish(h.comeAlong.onStage(slot));

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [{ id: "wave_3" }]]);
  });

  it("after a reload, docks onto the open stage with no carry and no entry clip, and goes home to her spot", async () => {
    const storage = fakeStorage();
    await docked({ storage });
    const reloaded = harness({ at: { x: 100, y: 80 }, storage });

    await reloaded.comeAlong.onStage(slot);
    expect(reloaded.locomotion.widen).not.toHaveBeenCalled();
    expect(reloaded.playMotion).not.toHaveBeenCalled();
    expect(reloaded.dock.attach).toHaveBeenCalledOnce();

    await reloaded.finish(reloaded.comeAlong.onStage(null));
    expect([reloaded.real.x, reloaded.real.y]).toEqual([1300, 80]);
  });

  it("after a reload, still stays when a drag or agent command kept her at the open", async () => {
    const storage = fakeStorage();
    const h = harness({ storage });
    h.setBusy(true);
    await h.comeAlong.onStage(slot);
    const reloaded = harness({ storage });
    reloaded.setReduced(true);

    await reloaded.comeAlong.onStage(slot);

    expect(reloaded.locomotion.hold).not.toHaveBeenCalled();
  });

  it("pins an edge clip at her window's right edge, easing it in over the carry after the hold", async () => {
    // A neutral pick at 0.5 is plain's third clip, peek_in.
    const h = harness({ roll: 0.5 });
    const done = h.comeAlong.onStage(slot);
    await vi.waitFor(() => expect(h.ticks.size).toBe(1));

    expect(h.setPeekTarget).not.toHaveBeenCalled();
    h.tick(200);
    await vi.waitFor(() => expect(h.setPeekTarget).toHaveBeenCalledOnce());
    await h.finish(done);

    // Her 400-px window's edge plus 0.06 × her 500 px.
    expect(h.setPeekTarget).toHaveBeenCalledWith({
      targetXpx: 430,
      easeMs: 900,
      holdsPosture: false,
    });
    expect(h.setMotionMirror).toHaveBeenCalledWith(false);
    expect(h.playMotion).toHaveBeenLastCalledWith({ id: "peek_in" });
  });

  it.each([
    ["a vanish", { x: 1500, y: 80 }, false, 'land {"x":200,"y":600}'],
    ["a fade", { x: 1300, y: 80 }, true, "appear"],
  ])("snaps an edge clip's pin while she is hidden in %s", async (_, at, reduced, shown) => {
    const h = harness({ at, roll: 0.5 });
    h.setReduced(reduced);

    await h.finish(h.comeAlong.onStage(slot));

    expect(h.events).toEqual(["vanish", "pin 430", "move 100,80", shown]);
    expect(h.setPeekTarget).toHaveBeenCalledWith({ targetXpx: 430, holdsPosture: false });
  });

  it.each([
    ["finishes", "idle", false, { easeMs: 600 }],
    ["finishes under reduced motion", "idle", true, undefined],
  ])("eases the pin back without an idle when the edge clip %s", async (_, next, reduced, release) => {
    const h = await docked({ roll: 0.5 });
    h.setReduced(reduced);
    h.playMotion.mockClear();

    h.tick(10);
    expect(h.setPeekTarget).toHaveBeenCalledOnce();
    h.setCurrent(next);
    h.tick(10);

    expect(h.setPeekTarget).toHaveBeenLastCalledWith(null, release);
    expect(h.playMotion).not.toHaveBeenCalled();
    expect(h.ticks.size).toBe(0);
  });

  it("hands peek over to idle at its play_ms and eases the pin back", async () => {
    // A neutral pick at 0.9 is plain's last clip, peek, pinned 0.12 × 500 px past the edge.
    const h = await docked({ roll: 0.9 });
    expect(h.setPeekTarget).toHaveBeenCalledWith(expect.objectContaining({ targetXpx: 460 }));
    h.playMotion.mockClear();

    h.setMotionTime(11.49);
    h.tick(10);
    expect(h.playMotion).not.toHaveBeenCalled();
    h.setMotionTime(11.5);
    h.tick(10);

    expect(h.playMotion.mock.calls).toEqual([[null]]);
    expect(h.setPeekTarget).toHaveBeenLastCalledWith(null, { easeMs: 600 });
  });

  it("idles her when the motion that replaced a stage peek ends and the controller returns to peek", async () => {
    const h = await docked({ roll: 0.9 });
    h.playMotion.mockClear();

    h.setCurrent("happy");
    h.tick(10);
    expect(h.setPeekTarget).toHaveBeenLastCalledWith(null, { easeMs: 600 });
    expect(h.playMotion).not.toHaveBeenCalled();
    h.setCurrent("peek");
    h.tick(10);

    expect(h.playMotion.mock.calls).toEqual([[null]]);
    expect(h.ticks.size).toBe(0);
  });

  it.each([
    ["an agent move", "agent", [[{ id: "drag" }], [null]]],
    ["a user drag", "drag", [[{ id: "drag" }]]],
  ] as const)("when %s takes her mid-carry, idles her only from the come-along's own pickup", async (_, by, calls) => {
    const h = harness();
    const done = h.comeAlong.onStage(slot);
    await h.pickUp();

    await h.abort(by);
    await done;

    expect(h.playMotion.mock.calls).toEqual(calls);
  });

  it.each([
    ["a start", false],
    ["a trip home", true],
  ])("returns her to idle when %s fails after her pickup", async (_, home) => {
    const h = harness({ at: { x: 1500, y: 80 } });
    if (home) {
      await h.finish(h.comeAlong.onStage(slot));
      h.playMotion.mockClear();
    }
    h.frameWindow.setPositionLogical.mockRejectedValueOnce(new Error("window gone"));

    await expect(h.finish(h.comeAlong.onStage(home ? null : slot))).rejects.toThrow("window gone");

    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [null]]);
  });

  it.each([
    ["no probe gives her height", { charHpx: null }],
    ["the renderer refuses the pin", { pinAccepted: false }],
  ])("plays an edge clip unpinned when %s", async (_, opts) => {
    const h = await docked({ roll: 0.5, ...opts });
    h.setCurrent("idle");
    h.tick(10);

    expect(h.playMotion).toHaveBeenLastCalledWith({ id: "peek_in" });
    expect(h.setPeekTarget).not.toHaveBeenCalledWith(null, expect.anything());
  });

  it("snaps the pin when a drag or an agent move takes her mid-carry", async () => {
    const h = harness({ roll: 0.5 });
    const done = h.comeAlong.onStage(slot);
    await h.pickUp();
    await vi.waitFor(() => expect(h.setPeekTarget).toHaveBeenCalledOnce());

    await h.abort();
    await done;

    expect(h.setPeekTarget).toHaveBeenLastCalledWith(null);
  });

  it("snaps the pin when a start fails after arming it", async () => {
    const h = harness({ at: { x: 1500, y: 80 }, roll: 0.5 });
    h.frameWindow.setPositionLogical.mockRejectedValueOnce(new Error("window gone"));

    await expect(h.finish(h.comeAlong.onStage(slot))).rejects.toThrow("window gone");

    expect(h.setPeekTarget).toHaveBeenLastCalledWith(null);
  });

  it("snaps the pin and plays no clip when the window closes during a stage peek", async () => {
    const h = await docked({ roll: 0.5 });
    h.playMotion.mockClear();

    await h.finish(h.comeAlong.onStage(null));

    expect(h.setPeekTarget).toHaveBeenLastCalledWith(null);
    expect(h.playMotion.mock.calls).toEqual([[{ id: "drag" }], [null]]);
  });

  it("after a reload, stays where she was dropped when a drag had taken her", async () => {
    const storage = fakeStorage();
    const h = await docked({ storage });
    await h.abort();
    const reloaded = harness({ at: { x: 100, y: 80 }, storage });

    await reloaded.comeAlong.onStage(slot);

    expect(reloaded.locomotion.hold).not.toHaveBeenCalled();
    expect(reloaded.dock.attach).not.toHaveBeenCalled();
  });
});
