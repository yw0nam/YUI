// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createBedScene, FRAME_MARGIN_M } from "../../ambient/bed-scene/bed-scene";
import type { TickContext, TickFn } from "../../renderer";
import { createCameraSettings } from "../../settings/avatar/camera-settings";
import { wireCamera } from "./wire-pet-stage";

function setup() {
  const camera = createCameraSettings();
  camera.setAzimuth(0.7);
  camera.setPolar(1.4);
  const stage = document.createElement("div");
  let zoom = 1;
  let orbit = { azimuth: 0, polar: 1.4 };
  let tick: TickFn | null = null;
  let current: { id: string; vrma_path: string } | null = null;
  const renderer = {
    setZoom: (next: number) => {
      zoom = next;
    },
    setOrbit: (next: typeof orbit) => {
      orbit = { ...next };
    },
    setIdleThrottleEnabled: vi.fn(),
    onTick: (fn: TickFn) => {
      tick = fn;
      return () => {
        tick = null;
      };
    },
    playMotion: (motion: { id: string } | null) => {
      current = motion ? { id: motion.id, vrma_path: "" } : null;
    },
    getCurrentMotion: () => current,
    getCurrentMotionTime: () => 0,
    getMotionDuration: () => 3,
    preloadMotion: async () => {},
    setMotionHold: vi.fn(),
    setSpringBonesHeld: vi.fn(),
    setGazeSuppressed: vi.fn(),
    loadProp: async () => ({
      setScale: vi.fn(),
      setOpacity: vi.fn(),
      dispose: vi.fn(),
      bounds: () => ({ min: { x: -1, y: 0, z: -2 }, max: { x: 1.5, y: 0.6, z: 0 } }),
    }),
    getModelRestHipsHeight: () => 0.9,
    getPxPerMetre: () => 200 * zoom * orbit.polar,
    getCharacterAnchor: () => ({ x: 200, y: 500 }),
  };
  const wiring = wireCamera({
    stage,
    renderer,
    cameraSettings: camera,
    idleThrottleSettings: { get: () => ({ enabled: true }), subscribe: () => () => {} },
  });
  const repark = vi.fn(async (_e: { leftPx: number; rightPx: number; anchorX: number }) => {});
  const scene = createBedScene({
    renderer,
    camera,
    frame: { park: async () => {}, repark, refit: async () => {}, release: async () => {} },
    placed: Promise.resolve(),
    liveliness: { setAsleep: vi.fn() },
    wakeTimeoutS: () => 60,
    onDone: vi.fn(),
    onWake: vi.fn(),
    onLying: vi.fn(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return {
    camera,
    stage,
    scene,
    repark,
    orbit: () => orbit,
    tick: () => tick?.({ vrm: {}, dt: 0, elapsed: 0 } as TickContext),
    dispose: () => {
      scene.cancel();
      wiring.dispose();
      camera.dispose();
    },
  };
}

describe("bed scene camera wiring", () => {
  it.each([
    "wheel",
    "polar",
    "azimuth",
  ] as const)("keeps the head-on view and reparks after a %s change", async (change) => {
    const h = setup();
    try {
      await h.scene.lieDown();
      expect(h.orbit().azimuth).toBe(0);
      if (change === "wheel") {
        h.stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, cancelable: true }));
        expect(h.camera.get().zoom).toBeGreaterThan(1);
      } else if (change === "polar") h.camera.setPolar(1.2);
      else h.camera.setAzimuth(0.9);

      const camera = h.camera.get();
      if (change === "wheel") expect(h.orbit().azimuth).toBe(0);
      h.tick();
      expect(h.repark).toHaveBeenCalledExactlyOnceWith({
        leftPx: (1 + FRAME_MARGIN_M) * (200 * camera.zoom * camera.polar),
        rightPx: (1.5 + FRAME_MARGIN_M) * (200 * camera.zoom * camera.polar),
        anchorX: 200,
      });
      expect(h.orbit()).toEqual({ azimuth: 0, polar: camera.polar });
      expect(h.scene.state()).toBe("asleep");
    } finally {
      h.dispose();
    }
  });
});
