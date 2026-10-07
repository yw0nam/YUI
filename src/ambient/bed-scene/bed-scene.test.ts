import { describe, expect, it, vi } from "vitest";
import type { PropHandle, TickContext, TickFn } from "../../renderer";
import {
  BED_PROP_URL,
  BED_SLEEP_MOTION_ID,
  BED_WAKE_MOTION_ID,
  type BedSceneDeps,
  CLIP_REST_HIPS_M,
  createBedScene,
  FRAME_MARGIN_M,
  PROP_FADE_S,
} from "./bed-scene";

const MOTION_S: Record<string, number> = { bed_sleep: 8, bed_wake: 2 };
const HOLD = `hold:${BED_SLEEP_MOTION_ID},${BED_WAKE_MOTION_ID}`;
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
  } = {},
) {
  /** Every observable effect in the order it happened. */
  const calls: string[] = [];
  let tick: TickFn | null = null;
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
        tick = fn;
        return () => {
          tick = null;
        };
      },
      // A hold drops every request outside its ids, as the renderer does.
      playMotion: (m) => {
        if (hold && !(m && hold.includes(m.id))) return;
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
    resolveProp: () => resolveProp(prop),
    resolvePark: () => resolvePark(),
    /** Another motion took the body: a request the hold let through, or a failed clip load. */
    setCurrent: (id: string) => {
      current = { id, vrma_path: "" };
    },
    ticking: () => tick !== null,
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

  it("wakes on a user wake once: eyes open, gaze restored, the wake clip plays", async () => {
    const h = makeHarness();
    await h.startAsleep();
    h.scene.wake("user");
    expect(h.scene.state()).toBe("waking");
    expect(h.calls.slice(-4)).toEqual([
      "asleep:false",
      "spring:false",
      "gaze:true",
      `play:${BED_WAKE_MOTION_ID}`,
    ]);
    const before = h.calls.length;
    h.scene.wake("timeout");
    expect(h.calls).toHaveLength(before);
  });

  it("wakes by itself once the tick clock passes the wake timeout", async () => {
    const h = makeHarness();
    await h.startAsleep();
    await h.runFrames(WAKE_TIMEOUT_S, 1);
    expect(h.scene.state()).toBe("asleep");
    await h.frame(1);
    expect(h.scene.state()).toBe("waking");
    await h.runFrames(2, 1);
    await h.frame(PROP_FADE_S);
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", { reason: "ended", cause: "timeout" });
  });

  it("ends in order: the clip ends, the bed fades, then dispose, frame release, hold release, idle, onDone", async () => {
    const h = makeHarness();
    await h.startAsleep();
    h.scene.wake("user");
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
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", { reason: "ended", cause: "user" });
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
      if (waking) h.scene.wake("user");
      h.scene.cancel();
      // The frame release is in flight: nothing arriving now restarts or re-ends the scene.
      h.scene.wake("user");
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
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", { reason: "swapped", cause: null });
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
    h.scene.wake("user");
    await h.runFrames(21);
    h.resolvePark();
    await h.flush();
    await h.frame(PROP_FADE_S);
    expect(new Set(h.calls.filter((c) => c.startsWith("prop.opacity:")))).toEqual(
      new Set(["prop.opacity:0"]),
    );
    expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", { reason: "ended", cause: "user" });
  });

  it("ends as lost when another motion has the body, asleep or waking", async () => {
    for (const waking of [false, true]) {
      const h = makeHarness();
      await h.startAsleep();
      if (waking) h.scene.wake("user");
      h.setCurrent(waking ? BED_SLEEP_MOTION_ID : "idle");
      await h.frame();
      expect(h.log.info).toHaveBeenCalledWith("bed_scene_end", {
        reason: "lost",
        cause: waking ? "user" : null,
      });
      expect(h.hold()).toBeNull();
      expect(h.count("onDone")).toBe(1);
    }
  });

  it("skips when woken or when the start fails before she has lain down", async () => {
    const woken = makeHarness();
    woken.scene.start();
    woken.scene.wake("user");
    await woken.flush();
    expect(woken.calls).not.toContain(HOLD);
    expect(woken.count("onDone")).toBe(1);
    expect(woken.log.info).toHaveBeenCalledWith("bed_scene_end", {
      reason: "skipped",
      cause: null,
    });

    const failed = makeHarness({ preload: "reject" });
    failed.scene.start();
    await failed.flush();
    expect(failed.log.info).toHaveBeenCalledWith("bed_scene_end", {
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
});
