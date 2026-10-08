import { describe, expect, it, vi } from "vitest";
import type { PropHandle, TickContext, TickFn } from "../../renderer";
import {
  BED_LIE_MOTION_ID,
  BED_PROP_URL,
  BED_SLEEP_MOTION_ID,
  BED_WAKE_MOTION_ID,
  type BedSceneDeps,
  CLIP_REST_HIPS_M,
  createBedScene,
  FRAME_MARGIN_M,
  PROP_FADE_S,
} from "./bed-scene";

const MOTION_S: Record<string, number> = { bed_lie: 3, bed_sleep: 8, bed_wake: 2 };
const HOLD = `hold:${BED_SLEEP_MOTION_ID},${BED_WAKE_MOTION_ID}`;
const BED_HOLD = `hold:${BED_LIE_MOTION_ID},${BED_SLEEP_MOTION_ID},${BED_WAKE_MOTION_ID}`;
const REST_HIPS_M = 1.8;
const PX_PER_METRE = 200;
const ANCHOR = { x: 150, y: 400 };
const BOUNDS = { min: { x: -1, y: 0, z: -2 }, max: { x: 1.5, y: 0.6, z: 0 } };
const STORED_ORBIT = { azimuth: 0.7, polar: 1.4 };
const WAKE_TIMEOUT_S = 10;

function makeHarness(
  over: {
    missing?: string;
    preload?: "reject";
    prop?: "pending" | "reject";
    dispose?: "throw";
    park?: "pending";
    release?: "reject";
    /** The renderer drops a request for this clip, as a held posture does. */
    refuse?: string;
  } = {},
) {
  /** Every observable effect in the order it happened. */
  const calls: string[] = [];
  /** Each onWake with the effect that came right before it. */
  const woke: Array<{ cause: string; after: string | undefined }> = [];
  /** Each posture change the scene reported. */
  const lying: boolean[] = [];
  let tick: TickFn | null = null;
  let subscribed = 0;
  let vrm = {};
  let hold: readonly string[] | null = null;
  let current: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  let clipT = 0;
  const cached = new Set<string>();
  const propUrls: string[] = [];
  const parked: unknown[] = [];
  const prop: PropHandle = {
    setScale: (s) => calls.push(`prop.scale:${s}`),
    setOpacity: (a) => calls.push(`prop.opacity:${a}`),
    bounds: () => BOUNDS,
    dispose: () => {
      calls.push("prop.dispose");
      if (over.dispose === "throw") throw new Error("dispose");
    },
  };
  let resolveProp: (p: PropHandle) => void = () => {};
  let resolvePark: () => void = () => {};
  let place: () => void = () => {};
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: BedSceneDeps = {
    renderer: {
      onTick: (fn) => {
        subscribed += 1;
        tick = fn;
        return () => {
          tick = null;
        };
      },
      // A hold drops every request outside its ids, as the renderer does.
      playMotion: (m) => {
        if (hold && !(m && hold.includes(m.id))) return;
        if (m && m.id === over.refuse) return;
        calls.push(`play:${m?.id ?? "null"}`);
        current = { id: m?.id ?? "idle", vrma_path: "" };
        clipT = 0;
      },
      getCurrentMotion: () => current,
      getCurrentMotionTime: () => (current ? Math.min(clipT, MOTION_S[current.id] ?? clipT) : null),
      getMotionDuration: (id) => (cached.has(id) ? (MOTION_S[id] ?? null) : null),
      preloadMotion: async (id) => {
        if (over.preload === "reject") throw new Error("preload");
        if (id !== over.missing) cached.add(id);
      },
      setMotionHold: (ids) => {
        hold = ids;
        calls.push(`hold:${ids ? ids.join(",") : "null"}`);
      },
      loadProp: (url) => {
        propUrls.push(url);
        if (over.prop === "reject") return Promise.reject(new Error("404"));
        if (over.prop === "pending") return new Promise((resolve) => (resolveProp = resolve));
        return Promise.resolve(prop);
      },
      getModelRestHipsHeight: () => REST_HIPS_M,
      getPxPerMetre: () => PX_PER_METRE,
      getCharacterAnchor: () => ANCHOR,
      setGazeEnabled: (enabled) => calls.push(`gaze:${enabled}`),
      setOrbit: (o) => calls.push(`orbit:${o.azimuth},${o.polar}`),
      setSpringBonesHeld: (held) => calls.push(`spring:${held}`),
    },
    liveliness: { setAsleep: (asleep) => calls.push(`asleep:${asleep}`) },
    gazeEnabled: () => true,
    camera: { get: () => STORED_ORBIT },
    frame: {
      park: async (e) => {
        parked.push(e);
        calls.push("frame.park");
        if (over.park === "pending") await new Promise<void>((resolve) => (resolvePark = resolve));
      },
      refit: async () => {
        calls.push("frame.refit");
      },
      release: async () => {
        calls.push("frame.release");
        if (over.release === "reject") throw new Error("release");
      },
    },
    placed: new Promise((resolve) => (place = resolve)),
    wakeTimeoutS: WAKE_TIMEOUT_S,
    onDone: () => calls.push("onDone"),
    onWake: (cause) => woke.push({ cause, after: calls.at(-1) }),
    onLying: (isLying) => lying.push(isLying),
    log,
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  let elapsed = 0;
  const frame = async (dt = 0.1): Promise<void> => {
    elapsed += dt;
    clipT += dt;
    tick?.({ vrm: vrm as never, dt, elapsed } as TickContext);
    await flush();
  };
  const scene = createBedScene(deps);
  return {
    scene,
    calls,
    woke,
    lying,
    log,
    prop,
    propUrls,
    parked,
    flush,
    frame,
    runFrames: async (n: number, dt?: number): Promise<void> => {
      for (let i = 0; i < n; i++) await frame(dt);
    },
    /** Start, land the boot placement and let the whole start sequence settle. */
    startAsleep: async (): Promise<void> => {
      scene.start();
      place();
      await flush();
    },
    place: () => place(),
    /** Lie down on command, land the placement and let the start sequence settle. */
    lieDown: async () => {
      const lay = scene.lieDown();
      place();
      await flush();
      return lay;
    },
    resolveProp: () => resolveProp(prop),
    resolvePark: () => resolvePark(),
    /** Another motion took the body: a request the hold let through, or a failed clip load. */
    setCurrent: (id: string) => {
      current = { id, vrma_path: "" };
    },
    ticking: () => tick !== null,
    subscribed: () => subscribed,
    /** A hot-swap: the renderer clears the hold and plays idle on the new model. */
    swapVrm: () => {
      vrm = {};
      hold = null;
      current = { id: "idle", vrma_path: "" };
    },
    hold: () => hold,
    count: (call: string) => calls.filter((c) => c === call).length,
  };
}

describe("createBedScene", () => {
  it("lies asleep under the hold, then shows the scaled bed in a frame parked after placement", async () => {
    const h = makeHarness();
    h.scene.start();
    expect(h.scene.state()).toBe("starting");
    await h.flush();
    expect(h.scene.state()).toBe("asleep");
    expect(h.propUrls).toEqual([BED_PROP_URL]);
    expect(h.calls).toEqual([
      HOLD,
      `play:${BED_SLEEP_MOTION_ID}`,
      "asleep:true",
      "spring:true",
      "gaze:false",
      `orbit:0,${STORED_ORBIT.polar}`,
      `prop.scale:${REST_HIPS_M / CLIP_REST_HIPS_M}`,
      "prop.opacity:0",
    ]);
    h.place();
    await h.flush();
    expect(h.calls.slice(-2)).toEqual(["frame.park", "prop.opacity:1"]);
    expect(h.parked).toEqual([
      {
        leftPx: (-BOUNDS.min.x + FRAME_MARGIN_M) * PX_PER_METRE,
        rightPx: (BOUNDS.max.x + FRAME_MARGIN_M) * PX_PER_METRE,
        anchorX: ANCHOR.x,
      },
    ]);
  });

  it("wakes on a click once: eyes open, the wake clip plays with the gaze still off, then onWake names the click", async () => {
    const h = makeHarness();
    await h.startAsleep();
    h.scene.wake("click");
    expect(h.scene.state()).toBe("waking");
    expect(h.calls.slice(-3)).toEqual([
      "asleep:false",
      "spring:false",
      `play:${BED_WAKE_MOTION_ID}`,
    ]);
    expect(h.woke).toEqual([{ cause: "click", after: `play:${BED_WAKE_MOTION_ID}` }]);
    const before = h.calls.length;
    h.scene.wake("timeout");
    expect(h.calls).toHaveLength(before);
    expect(h.woke).toHaveLength(1);
  });

  it("wakes on a message without onWake, and reports the message wake once", async () => {
    const h = makeHarness();
    await h.startAsleep();
    expect(h.scene.takeMessageWake()).toBe(false);
    h.scene.wake("message");
    expect(h.calls.at(-1)).toBe(`play:${BED_WAKE_MOTION_ID}`);
    expect(h.woke).toEqual([]);
    expect(h.scene.takeMessageWake()).toBe(true);
    expect(h.scene.takeMessageWake()).toBe(false);
  });

  it("drops a message wake nobody took once the scene ends", async () => {
    const h = makeHarness();
    await h.startAsleep();
    h.scene.wake("message");
    await h.runFrames(20);
    await h.frame(PROP_FADE_S);
    expect(h.scene.state()).toBe("done");
    expect(h.scene.takeMessageWake()).toBe(false);
  });

  it("wakes by itself once the tick clock passes the wake timeout", async () => {
    const h = makeHarness();
    await h.startAsleep();
    await h.runFrames(WAKE_TIMEOUT_S, 1);
    expect(h.scene.state()).toBe("asleep");
    await h.frame(1);
    expect(h.scene.state()).toBe("waking");
    expect(h.woke).toEqual([{ cause: "timeout", after: `play:${BED_WAKE_MOTION_ID}` }]);
    await h.runFrames(2, 1);
    await h.frame(PROP_FADE_S);
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "ended",
      cause: "timeout",
    });
  });

  it("ends in order: the clip ends, the bed fades, then dispose, frame release, hold release, idle, onDone", async () => {
    const h = makeHarness();
    await h.startAsleep();
    h.scene.wake("click");
    await h.runFrames(20);
    expect(h.scene.state()).toBe("waking");
    expect(h.calls.at(-1)).toBe(`play:${BED_WAKE_MOTION_ID}`);
    await h.frame(PROP_FADE_S / 2);
    expect(h.calls.at(-1)).toBe("prop.opacity:0.5");
    await h.frame(PROP_FADE_S / 2);
    expect(h.scene.state()).toBe("done");
    expect(h.calls.slice(h.calls.lastIndexOf("prop.opacity:0"))).toEqual([
      "prop.opacity:0",
      "asleep:false",
      "spring:false",
      "gaze:true",
      `orbit:${STORED_ORBIT.azimuth},${STORED_ORBIT.polar}`,
      "prop.dispose",
      "frame.release",
      "hold:null",
      "play:null",
      "onDone",
    ]);
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "ended",
      cause: "click",
    });
  });

  it("refits the frame on a drag end while the scene runs, and not after it has finished", async () => {
    const h = makeHarness();
    await h.startAsleep();
    h.scene.onDragEnd();
    expect(h.calls.filter((c) => c === "frame.refit")).toHaveLength(1);
    h.scene.cancel();
    await h.runFrames(2);
    expect(h.scene.state()).toBe("done");
    h.scene.onDragEnd();
    expect(h.calls.filter((c) => c === "frame.refit")).toHaveLength(1);
  });

  it("skips without a hold or a prop when a clip is missing or the prop load rejects", async () => {
    const missing = makeHarness({ missing: BED_WAKE_MOTION_ID });
    await missing.startAsleep();
    expect(missing.calls).not.toContain(HOLD);
    expect(missing.propUrls).toEqual([]);
    expect(missing.count("onDone")).toBe(1);
    expect(missing.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "skipped",
      cause: null,
    });

    const rejected = makeHarness({ prop: "reject" });
    await rejected.startAsleep();
    expect(rejected.hold()).toBeNull();
    expect(rejected.calls).not.toContain("prop.opacity:1");
    expect(rejected.calls.at(-2)).toBe("play:null");
    expect(rejected.count("onDone")).toBe(1);
    expect(rejected.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "skipped",
      cause: null,
    });
  });

  it("stays cancelled when the preload or the prop load lands late", async () => {
    const preloading = makeHarness();
    preloading.scene.start();
    preloading.scene.cancel();
    preloading.place();
    await preloading.flush();
    expect(preloading.calls).not.toContain(HOLD);
    expect(preloading.propUrls).toEqual([]);
    expect(preloading.count("onDone")).toBe(1);

    const loading = makeHarness({ prop: "pending" });
    await loading.startAsleep();
    loading.scene.cancel();
    await loading.flush();
    expect(loading.count("onDone")).toBe(1);
    loading.resolveProp();
    await loading.flush();
    expect(loading.calls.at(-1)).toBe("prop.dispose");
    expect(loading.calls).not.toContain("frame.park");
    expect(loading.hold()).toBeNull();
    expect(loading.count("onDone")).toBe(1);
  });

  it("cancels from asleep and from waking: no hold, no prop, the frame unparked, onDone once", async () => {
    for (const waking of [false, true]) {
      const h = makeHarness();
      await h.startAsleep();
      if (waking) h.scene.wake("click");
      h.scene.cancel();
      // The frame release is in flight: nothing arriving now restarts or re-ends the scene.
      h.scene.wake("click");
      h.scene.cancel();
      await h.frame();
      expect(h.scene.state()).toBe("done");
      expect(h.hold()).toBeNull();
      expect(h.calls.filter((c) => c.startsWith("spring:")).at(-1)).toBe("spring:false");
      expect(h.count("prop.dispose")).toBe(1);
      expect(h.count("frame.release")).toBe(1);
      expect(h.calls.slice(-2)).toEqual(["play:null", "onDone"]);
      expect(h.count("onDone")).toBe(1);
    }
  });

  it("ends as swapped when the tick brings another VRM", async () => {
    const h = makeHarness();
    await h.startAsleep();
    await h.frame();
    h.swapVrm();
    await h.frame();
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "swapped",
      cause: null,
    });
    expect(h.calls.slice(-4)).toEqual(["prop.dispose", "frame.release", "hold:null", "onDone"]);
  });

  it("never parks when cancelled between the prop load and the placement", async () => {
    const h = makeHarness();
    h.scene.start();
    await h.flush();
    h.scene.cancel();
    h.place();
    await h.flush();
    expect(h.calls).not.toContain("frame.park");
    expect(h.calls).not.toContain("prop.opacity:1");
  });

  it("never shows the bed when cancelled while the frame is parking", async () => {
    const h = makeHarness({ park: "pending" });
    await h.startAsleep();
    expect(h.calls.at(-1)).toBe("frame.park");
    h.scene.cancel();
    h.resolvePark();
    await h.flush();
    expect(h.calls).not.toContain("prop.opacity:1");
  });

  it("does not pop the bed in when she wakes before the frame is parked", async () => {
    const h = makeHarness({ park: "pending" });
    await h.startAsleep();
    h.scene.wake("click");
    await h.runFrames(21);
    h.resolvePark();
    await h.flush();
    await h.frame(PROP_FADE_S);
    expect(new Set(h.calls.filter((c) => c.startsWith("prop.opacity:")))).toEqual(
      new Set(["prop.opacity:0"]),
    );
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "ended",
      cause: "click",
    });
  });

  it("ends as lost when another motion has the body, asleep or waking", async () => {
    for (const waking of [false, true]) {
      const h = makeHarness();
      await h.startAsleep();
      if (waking) h.scene.wake("click");
      h.setCurrent(waking ? BED_SLEEP_MOTION_ID : "idle");
      await h.frame();
      expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
        entry: "launch",
        reason: "lost",
        cause: waking ? "click" : null,
      });
      expect(h.hold()).toBeNull();
      expect(h.count("onDone")).toBe(1);
    }
  });

  it("skips when woken or when the start fails before she has lain down", async () => {
    const woken = makeHarness();
    woken.scene.start();
    woken.scene.wake("click");
    await woken.flush();
    expect(woken.calls).not.toContain(HOLD);
    expect(woken.woke).toEqual([]);
    expect(woken.count("onDone")).toBe(1);
    expect(woken.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "skipped",
      cause: null,
    });

    const failed = makeHarness({ preload: "reject" });
    failed.scene.start();
    await failed.flush();
    expect(failed.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "launch",
      reason: "skipped",
      cause: null,
    });
    expect(failed.count("onDone")).toBe(1);
  });

  it("unregisters its tick hook at the end", async () => {
    const h = makeHarness();
    await h.startAsleep();
    expect(h.ticking()).toBe(true);
    h.scene.cancel();
    expect(h.ticking()).toBe(false);
  });

  it("releases the hold and reports done although the frame release or the prop dispose fails", async () => {
    for (const over of [{ release: "reject" }, { dispose: "throw" }] as const) {
      const h = makeHarness(over);
      await h.startAsleep();
      h.scene.cancel();
      await h.flush();
      expect(h.hold()).toBeNull();
      expect(h.count("frame.release")).toBe(1);
      expect(h.calls.slice(-2)).toEqual(["play:null", "onDone"]);
    }
  });

  it("reports the posture as lying from the sleep clip until the wake clip starts", async () => {
    const h = makeHarness();
    await h.startAsleep();
    expect(h.lying).toEqual([true]);
    h.scene.wake("click");
    expect(h.lying).toEqual([true, false]);
  });
});

describe("createBedScene — lying down on command", () => {
  it("shows the bed first, then plays the lying-down clip and answers lying once she lies", async () => {
    const h = makeHarness();
    const lay = h.scene.lieDown();
    let answered: string | undefined;
    void lay.then((ok) => {
      answered = ok;
    });
    await h.flush();
    expect(h.scene.state()).toBe("starting");
    expect(answered).toBeUndefined();
    expect(h.lying).toEqual([]);
    h.place();
    await h.flush();

    expect(answered).toBe("lying");
    expect(h.scene.state()).toBe("asleep");
    expect(h.propUrls).toEqual([BED_PROP_URL]);
    expect(h.calls).toEqual([
      BED_HOLD,
      `orbit:0,${STORED_ORBIT.polar}`,
      `prop.scale:${REST_HIPS_M / CLIP_REST_HIPS_M}`,
      "prop.opacity:0",
      "frame.park",
      "prop.opacity:1",
      `play:${BED_LIE_MOTION_ID}`,
      "asleep:true",
      "spring:true",
      "gaze:false",
    ]);
    expect(h.lying).toEqual([true]);
  });

  it("holds the sleep loop once the lying-down clip ends, then wakes by the timeout", async () => {
    const h = makeHarness();
    await h.lieDown();
    await h.runFrames(2, 1);
    expect(h.calls.at(-1)).not.toBe(`play:${BED_SLEEP_MOTION_ID}`);
    await h.frame(1);
    expect(h.calls.at(-1)).toBe(`play:${BED_SLEEP_MOTION_ID}`);
    expect(h.count(`play:${BED_SLEEP_MOTION_ID}`)).toBe(1);

    await h.runFrames(WAKE_TIMEOUT_S, 1);
    expect(h.scene.state()).toBe("asleep");
    expect(h.woke).toEqual([]);
    await h.frame(1);
    expect(h.scene.state()).toBe("waking");
    expect(h.woke).toEqual([{ cause: "timeout", after: `play:${BED_WAKE_MOTION_ID}` }]);
    await h.runFrames(40);
    await h.frame(PROP_FADE_S);
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "command",
      reason: "ended",
      cause: "timeout",
    });
  });

  it("wakes on a click, a message or the backend, each starting the wake clip", async () => {
    for (const cause of ["click", "message", "agent"] as const) {
      const h = makeHarness();
      await h.lieDown();
      await h.runFrames(40);
      h.scene.wake(cause);
      expect(h.scene.state()).toBe("waking");
      expect(h.calls.at(-1)).toBe(`play:${BED_WAKE_MOTION_ID}`);
      expect(h.lying).toEqual([true, false]);
      // The user's click is a candidate; a message rides its own turn and the backend's stand is silent.
      expect(h.woke.map((w) => w.cause)).toEqual(cause === "click" ? ["click"] : []);
      expect(h.scene.takeMessageWake()).toBe(cause === "message");
    }
  });

  it("wakes while the lying-down clip still plays", async () => {
    const h = makeHarness();
    await h.lieDown();
    h.scene.wake("agent");
    expect(h.scene.state()).toBe("waking");
    expect(h.calls.at(-1)).toBe(`play:${BED_WAKE_MOTION_ID}`);
  });

  it("answers failed and leaves the scene alone while a scene already runs", async () => {
    const h = makeHarness();
    await h.startAsleep();
    const before = h.calls.length;

    expect(await h.lieDown()).toBe("failed");
    expect(h.calls).toHaveLength(before);
    expect(h.scene.state()).toBe("asleep");
  });

  it("answers failed when a clip is missing or the bed does not load", async () => {
    const missing = makeHarness({ missing: BED_LIE_MOTION_ID });
    expect(await missing.lieDown()).toBe("failed");
    expect(missing.calls).not.toContain(BED_HOLD);
    expect(missing.lying).toEqual([]);
    expect(missing.count("onDone")).toBe(1);

    const noBed = makeHarness({ prop: "reject" });
    expect(await noBed.lieDown()).toBe("failed");
    expect(noBed.hold()).toBeNull();
    expect(noBed.calls).not.toContain(`play:${BED_LIE_MOTION_ID}`);
  });

  it("answers interrupted when the user's click, a message or a drag comes during the start", async () => {
    for (const interrupt of [
      (h: ReturnType<typeof makeHarness>) => h.scene.wake("click"),
      (h: ReturnType<typeof makeHarness>) => h.scene.wake("message"),
      (h: ReturnType<typeof makeHarness>) => h.scene.cancelStart(),
    ]) {
      const h = makeHarness({ prop: "pending" });
      const lay = h.scene.lieDown();
      await h.flush();
      interrupt(h);
      expect(await lay).toBe("interrupted");
      expect(h.woke).toEqual([]);
      expect(h.hold()).toBeNull();
      expect(h.lying).toEqual([]);
      expect(h.count("onDone")).toBe(1);
    }
  });

  it("leaves a scene that is lying or on the launch entry alone when a drag cancels a start", async () => {
    const lying = makeHarness();
    await lying.lieDown();
    lying.scene.cancelStart();
    expect(lying.scene.state()).toBe("asleep");

    const launch = makeHarness();
    launch.scene.start();
    launch.scene.cancelStart();
    expect(launch.scene.state()).toBe("starting");
  });

  it("answers failed, never reports lying and ends when the renderer refuses the lying-down clip", async () => {
    const h = makeHarness({ refuse: BED_LIE_MOTION_ID });

    expect(await h.lieDown()).toBe("failed");
    expect(h.lying).toEqual([]);
    expect(h.calls).not.toContain("asleep:true");
    expect(h.scene.state()).toBe("done");
    expect(h.hold()).toBeNull();
    expect(h.count("onDone")).toBe(1);
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
      entry: "command",
      reason: "skipped",
      cause: null,
    });
  });

  it("does not fire the wake clip or the posture again after a cancel", async () => {
    const h = makeHarness();
    await h.lieDown();
    h.scene.cancel();
    await h.flush();
    expect(h.lying).toEqual([true, false]);
    expect(h.hold()).toBeNull();
    expect(h.count("onDone")).toBe(1);
  });

  it("runs again after it ended, on either entry, with a fresh timeout and a fresh bed", async () => {
    const h = makeHarness();
    await h.lieDown();
    h.scene.wake("agent");
    await h.runFrames(40);
    await h.frame(PROP_FADE_S);
    expect(h.scene.state()).toBe("done");
    expect(h.count("onDone")).toBe(1);
    expect(h.lying).toEqual([true, false]);

    expect(await h.lieDown()).toBe("lying");
    expect(h.scene.state()).toBe("asleep");
    expect(h.count("prop.dispose")).toBe(1);
    expect(h.propUrls).toHaveLength(2);
    expect(h.lying).toEqual([true, false, true]);
    h.scene.wake("click");
    await h.runFrames(40);
    await h.frame(PROP_FADE_S);
    expect(h.scene.state()).toBe("done");

    h.scene.start();
    await h.flush();
    await h.runFrames(WAKE_TIMEOUT_S + 1, 1);
    expect(h.scene.state()).toBe("waking");
    expect(h.woke.at(-1)?.cause).toBe("timeout");
    await h.runFrames(40);
    await h.frame(PROP_FADE_S);
    expect(h.scene.state()).toBe("done");
    expect(h.ticking()).toBe(false);
    // One tick listener per run, and every park has its release.
    expect(h.subscribed()).toBe(3);
    expect(h.count("frame.park")).toBe(3);
    expect(h.count("frame.release")).toBe(3);
  });
});

describe("createBedScene — the gaze stays off while the scene owns the body", () => {
  /** The gaze state after the last call: what the head tracking is doing now. */
  const gazeNow = (h: ReturnType<typeof makeHarness>) =>
    h.calls.filter((c) => c.startsWith("gaze:")).at(-1);

  type Harness = ReturnType<typeof makeHarness>;
  const entries: Array<[string, (h: Harness) => Promise<unknown>]> = [
    ["launch", (h) => h.startAsleep()],
    ["command", (h) => h.lieDown()],
  ];
  const ends: Array<[string, (h: Harness) => Promise<void>]> = [
    [
      "ended",
      async (h) => {
        h.scene.wake("click");
        await h.runFrames(40);
        await h.frame(PROP_FADE_S);
      },
    ],
    [
      "lost",
      async (h) => {
        h.setCurrent("idle");
        await h.frame();
      },
    ],
    [
      "swapped",
      async (h) => {
        h.swapVrm();
        await h.frame();
      },
    ],
    [
      "cancelled",
      async (h) => {
        h.scene.cancel();
        await h.flush();
      },
    ],
  ];

  it.each(
    entries,
  )("on the %s entry it is off from lying through the wake clip", async (_name, enter) => {
    const h = makeHarness();
    await enter(h);
    await h.runFrames(40);
    expect(gazeNow(h)).toBe("gaze:false");

    h.scene.wake("click");
    await h.runFrames(10);
    expect(h.scene.state()).toBe("waking");
    expect(gazeNow(h)).toBe("gaze:false");
    expect(h.calls).not.toContain("gaze:true");
  });

  it.each(
    entries.flatMap(([entry, enter]) =>
      ends.map(([end, finish]) => [entry, end, enter, finish] as const),
    ),
  )("on the %s entry it is back on once the scene ended as %s", async (_entry, _end, enter, finish) => {
    const h = makeHarness();
    await enter(h);
    await h.runFrames(40);
    expect(gazeNow(h)).toBe("gaze:false");

    await finish(h);
    expect(h.scene.state()).toBe("done");
    expect(gazeNow(h)).toBe("gaze:true");
  });

  it("is never turned off when the scene is skipped before she lies down, and ends on", async () => {
    const h = makeHarness({ missing: BED_WAKE_MOTION_ID });
    await h.startAsleep();

    expect(h.scene.state()).toBe("done");
    expect(h.calls).not.toContain("gaze:false");
    expect(gazeNow(h)).toBe("gaze:true");
  });
});
