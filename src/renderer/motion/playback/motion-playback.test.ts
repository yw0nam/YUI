import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { MotionRegistry } from "../../../contract";
import type { ClipLibrary } from "../clip/clip-library";
import { createMotionPlayback } from "./motion-playback";

const IDLE_PATH = "/motions/idle.vrma";
const WAVE_PATH = "/motions/wave.vrma";

const registry: MotionRegistry = {
  idle: {
    vrma_path: IDLE_PATH,
    kind: "ambient",
    loop: true,
    priority: 0,
    interrupt_policy: "replace",
    fade_ms: 0,
  },
  wave: {
    vrma_path: WAVE_PATH,
    kind: "oneshot",
    loop: false,
    priority: 70,
    interrupt_policy: "replace",
    fade_ms: 0,
  },
  bed_sleep: {
    vrma_path: "/motions/bed_sleep.vrma",
    kind: "oneshot",
    loop: false,
    priority: 60,
    interrupt_policy: "replace",
    fade_ms: 0,
  },
  bed_wake: {
    vrma_path: "/motions/bed_wake.vrma",
    kind: "oneshot",
    loop: false,
    priority: 60,
    interrupt_policy: "replace",
    fade_ms: 0,
  },
};

/** Lets startMotion's async clip loads settle before asserting. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makePlayback(loadImpl?: (path: string) => Promise<THREE.AnimationClip | null>) {
  const clips = {
    load: vi.fn(
      async (path: string): Promise<THREE.AnimationClip | null> =>
        new THREE.AnimationClip(path, 1, []),
    ),
    playbackClip: vi.fn((clip: THREE.AnimationClip) => clip),
  };
  if (loadImpl) clips.load.mockImplementation(loadImpl);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const vrm = { scene: new THREE.Object3D() } as unknown as VRM;
  const motion = createMotionPlayback({
    clips: clips as Pick<ClipLibrary, "load" | "playbackClip">,
    registry,
    heldPosture: () => null,
    log,
  });
  return { motion, clips, log, vrm };
}

describe("createMotionPlayback", () => {
  it("a oneshot's finish drives the next motion", async () => {
    const { motion, clips, vrm } = makePlayback();
    motion.onVrmLoaded(vrm);
    await flush();
    expect(motion.current()?.id).toBe("idle");
    expect(motion.isConverging()).toBe(false);

    motion.playMotion({ id: "wave" });
    // Committed but not yet started: the running action is still idle's, so no playhead.
    expect(motion.currentTime()).toBeNull();
    await flush();
    expect(motion.current()?.id).toBe("wave");
    expect(motion.currentTime()).toBe(0);
    expect(motion.isConverging()).toBe(true);

    // Past the 1s clip end — the mixer dispatches "finished" for the oneshot.
    motion.step({ dt: 1.5 });
    await flush();

    expect(motion.current()?.id).toBe("idle");
    const idleLoads = clips.load.mock.calls.filter(([path]) => path === IDLE_PATH);
    expect(idleLoads.length).toBeGreaterThanOrEqual(2);
  });

  it("a failed clip falls back to the idle baseline", async () => {
    const { motion, log, vrm } = makePlayback(async (path) =>
      path === WAVE_PATH ? null : new THREE.AnimationClip(path, 1, []),
    );
    motion.onVrmLoaded(vrm);
    await flush();

    motion.playMotion({ id: "wave" });
    await flush();

    expect(motion.current()?.id).toBe("idle");
    expect(log.warn).toHaveBeenCalledWith(
      "motion_fallback_to_idle",
      expect.objectContaining({ failed_id: "wave" }),
    );
  });

  it("a hold keeps its motion against outside requests until released", async () => {
    const { motion, clips, vrm } = makePlayback();
    const idleLoads = (): number =>
      clips.load.mock.calls.filter(([path]) => path === IDLE_PATH).length;
    motion.onVrmLoaded(vrm);
    await flush();

    motion.setMotionHold(["bed_sleep", "bed_wake"]);
    motion.playMotion({ id: "bed_sleep" });
    await flush();
    expect(motion.current()?.id).toBe("bed_sleep");

    motion.playMotion({ id: "wave" });
    motion.playMotion(null);
    await flush();
    expect(motion.current()?.id).toBe("bed_sleep");

    // Past the 1s clip end — the held oneshot's "finished" is not chained to idle.
    const before = idleLoads();
    motion.step({ dt: 1.5 });
    await flush();
    expect(motion.current()?.id).toBe("bed_sleep");
    expect(idleLoads()).toBe(before);

    motion.setMotionHold(null);
    motion.playMotion(null);
    await flush();
    expect(motion.current()?.id).toBe("idle");
  });

  it("a VRM swap releases the hold so the new model plays idle", async () => {
    const { motion, vrm } = makePlayback();
    motion.onVrmLoaded(vrm);
    await flush();
    motion.setMotionHold(["bed_sleep", "bed_wake"]);

    motion.onVrmDisposed();
    motion.onVrmLoaded(vrm);
    await flush();

    expect(motion.current()?.id).toBe("idle");
  });
});
