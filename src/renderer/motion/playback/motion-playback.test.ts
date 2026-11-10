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
    grounded: true,
  },
  wave: {
    vrma_path: WAVE_PATH,
    kind: "oneshot",
    loop: false,
    priority: 70,
    interrupt_policy: "replace",
    fade_ms: 0,
  },
  sit: {
    vrma_path: "/motions/sit.vrma",
    kind: "oneshot",
    loop: false,
    priority: 70,
    interrupt_policy: "replace",
    fade_ms: 200,
  },
  nod: {
    vrma_path: "/motions/nod.vrma",
    kind: "oneshot",
    loop: false,
    priority: 80,
    interrupt_policy: "replace",
    fade_ms: 200,
    grounded: true,
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
});

describe("groundedWeight", () => {
  // idle is grounded (no fade), sit is not (200 ms fade), nod is grounded (200 ms fade), wave is not (no fade).
  it.each([
    ["a grounded motion at rest", [0.1], [1]],
    [
      "a 200 ms fade to an ungrounded motion, mid-fade and past its end",
      ["sit", 0.1, 0.15],
      [0.5, 0],
    ],
    ["a grounded motion interrupting that fade 50 ms in", ["sit", 0.05, "nod", 0.05], [0.75, 0.5]],
    ["a zero-fade switch to an ungrounded motion", [0.1, "wave", 0.1], [1, 0]],
  ] as const)("follows the crossfade: %s", async (_title, steps, expected) => {
    const { motion, vrm } = makePlayback();
    motion.onVrmLoaded(vrm);
    await flush();
    const weights: number[] = [];
    for (const s of steps) {
      if (typeof s === "string") {
        motion.playMotion({ id: s });
        await flush();
      } else {
        motion.step({ dt: s });
        weights.push(Math.round(motion.groundedWeight() * 1e6) / 1e6);
      }
    }
    expect(weights).toEqual(expected);
  });
});
