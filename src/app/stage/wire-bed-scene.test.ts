import { afterEach, describe, expect, it, vi } from "vitest";
import type { BedSceneDeps } from "../../ambient/bed-scene/bed-scene";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  sceneDeps: [] as unknown[],
  scene: {
    start: vi.fn(),
    lieDown: vi.fn(async () => true),
    state: vi.fn(() => "idle"),
    wake: vi.fn(),
    cancel: vi.fn(),
    onDragEnd: vi.fn(),
    takeMessageWake: vi.fn(() => true),
  },
  onWake: vi.fn(),
}));

vi.mock("../../tauri-env", () => ({ isTauri: mocks.isTauri }));
vi.mock("../../ambient/bed-scene/bed-scene", () => ({
  createBedScene: (deps: unknown) => {
    mocks.sceneDeps.push(deps);
    return mocks.scene;
  },
}));

import { createBedSceneHold } from "./bed-scene-hold";
import { wireBedScene } from "./wire-bed-scene";

function setup(over: { enabled?: boolean; ready?: Promise<void>; frameWindow?: () => never } = {}) {
  const calls: string[] = [];
  const pushed: string[] = [];
  const frameCalls: number[][] = [];
  const setViewWindow = vi.fn();
  const teardowns: Array<() => void> = [];
  const bedScene = wireBedScene({
    renderer: { setViewWindow } as never,
    ambient: {} as never,
    settings: {
      bedSceneSettings: { get: () => ({ enabled: over.enabled ?? true, wakeTimeoutS: 45 }) },
      gazeSettings: { get: () => ({ enabled: true }) },
      cameraSettings: { get: () => ({ zoom: 1, azimuth: 0.7, polar: 1.4 }) },
    } as never,
    bus: { push: (env: { event_name: string }) => pushed.push(env.event_name) } as never,
    applyCamera: () => calls.push("applyCamera"),
    hold: createBedSceneHold(),
    register: (teardown) => teardowns.push(teardown),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const start = (): BedSceneDeps => {
    bedScene.start(
      {
        frame: {
          ready: over.ready ?? Promise.resolve(),
          frameWindow:
            over.frameWindow ??
            (() => ({
              outerPosition: async () => ({ x: 500, y: 300 }),
              outerSize: async () => ({ width: 400, height: 600 }),
              scaleFactor: async () => 1,
              setPositionLogical: async () => {},
              setFrameLogical: async (...frame) => {
                frameCalls.push(frame);
              },
            })),
        },
        placed: Promise.resolve(),
        place: async () => {
          calls.push(`place:held=${bedScene.isHeld()}`);
        },
        setKeepOnScreenPaused: () => {},
        drop: () => calls.push(`drop:held=${bedScene.isHeld()}`),
      },
      mocks.onWake,
    );
    return mocks.sceneDeps.at(-1) as BedSceneDeps;
  };
  return { bedScene, start, calls, pushed, frameCalls, setViewWindow, teardowns };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.sceneDeps.length = 0;
  mocks.isTauri.mockReturnValue(false);
});

describe("wireBedScene", () => {
  it("builds no scene and holds nothing with the setting off or reduced motion on", () => {
    const off = setup({ enabled: false });
    off.start();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const reduced = setup();
    reduced.start();

    expect(mocks.sceneDeps).toEqual([]);
    expect(off.bedScene.isHeld()).toBe(false);
    expect(reduced.bedScene.isHeld()).toBe(false);
    expect(off.bedScene.takeMessageWake()).toBe(false);
    expect(off.teardowns).toEqual([]);
  });

  it("holds from construction until the scene is done, then re-applies the camera and drops once", () => {
    const h = setup();
    expect(h.bedScene.isHeld()).toBe(true);
    const deps = h.start();

    expect(mocks.scene.start).toHaveBeenCalledOnce();
    expect(deps.wakeTimeoutS).toBe(45);
    expect(deps.frame).toBeNull();
    expect(h.teardowns).toContain(mocks.scene.cancel);
    expect(h.bedScene.isHeld()).toBe(true);

    deps.onDone();
    expect(h.bedScene.isHeld()).toBe(false);
    expect(h.calls).toEqual(["applyCamera", "drop:held=false"]);
  });

  it("releases a hold that was never started when the bootstrap tears down", () => {
    const h = setup();
    expect(h.bedScene.isHeld()).toBe(true);

    for (const teardown of h.teardowns) teardown();

    expect(h.bedScene.isHeld()).toBe(false);
  });

  it("forwards a wake with its cause, the message-wake take and a drag end to the scene", () => {
    const h = setup();
    h.bedScene.wake("click");
    expect(mocks.scene.wake).not.toHaveBeenCalled();
    expect(h.bedScene.takeMessageWake()).toBe(false);
    const deps = h.start();
    h.bedScene.wake("click");
    h.bedScene.wake("message");
    h.bedScene.onDragEnd();

    expect(mocks.scene.wake.mock.calls).toEqual([["click"], ["message"]]);
    expect(h.bedScene.takeMessageWake()).toBe(true);
    expect(mocks.scene.onDragEnd).toHaveBeenCalledOnce();
  });

  it("signals a user's wake and the timeout, and keeps the backend's own wake quiet", () => {
    const h = setup();
    const deps = h.start();

    deps.onWake("click");
    deps.onWake("timeout");
    deps.onWake("agent");

    expect(mocks.onWake.mock.calls).toEqual([["click"], ["timeout"]]);
  });

  it("reports lying and getting up as the bed's posture events", () => {
    const h = setup();
    const deps = h.start();

    deps.onLying(true);
    deps.onLying(false);

    expect(h.pushed).toEqual(["avatar.bed_start", "avatar.bed_end"]);
  });

  it("unparks a park that was still waiting for the real window when the release came", async () => {
    mocks.isTauri.mockReturnValue(true);
    let ready: () => void = () => {};
    const h = setup({ ready: new Promise((resolve) => (ready = resolve)) });
    const frame = h.start().frame!;

    const parked = frame.park({ leftPx: 250, rightPx: 100, anchorX: 200 });
    const released = frame.release();
    await frame.refit();
    expect(h.frameCalls).toEqual([]);
    ready();
    await Promise.all([parked, released]);

    expect(h.frameCalls).toEqual([
      [450, 300, 450, 600],
      [550, 300, 400, 600],
    ]);
    expect(h.setViewWindow).toHaveBeenLastCalledWith(null);
  });

  it("rejects the park and releases nothing when the real window is missing", async () => {
    mocks.isTauri.mockReturnValue(true);
    const h = setup({
      frameWindow: () => {
        throw new Error("not ready");
      },
    });
    const frame = h.start().frame!;

    await expect(frame.park({ leftPx: 250, rightPx: 100, anchorX: 200 })).rejects.toThrow(
      "not ready",
    );
    await frame.release();
    expect(h.frameCalls).toEqual([]);
  });

  describe("on command", () => {
    it("holds, places her on the floor, then lies her down, and lets go when the scene is done", async () => {
      const h = setup({ enabled: false });
      expect(h.bedScene.isHeld()).toBe(false);
      h.start();
      mocks.scene.lieDown.mockImplementation(async () => {
        h.calls.push("lieDown");
        return true;
      });
      expect(mocks.sceneDeps).toEqual([]);
      expect(h.bedScene.bed.phase()).toBe("off");

      expect(await h.bedScene.bed.lieDown()).toBe(true);
      expect(h.calls).toEqual(["place:held=true", "lieDown"]);
      expect(mocks.scene.start).not.toHaveBeenCalled();
      expect(h.teardowns).toContain(mocks.scene.cancel);

      (mocks.sceneDeps.at(-1) as BedSceneDeps).onDone();
      expect(h.bedScene.isHeld()).toBe(false);
      expect(h.calls.slice(-2)).toEqual(["applyCamera", "drop:held=false"]);
    });

    it("reuses one scene for the next lie-down and releases the hold when it fails to start", async () => {
      const h = setup({ enabled: false });
      h.start();
      mocks.scene.lieDown.mockImplementation(async () => {
        (mocks.sceneDeps.at(-1) as BedSceneDeps).onDone();
        return false;
      });

      expect(await h.bedScene.bed.lieDown()).toBe(false);
      expect(await h.bedScene.bed.lieDown()).toBe(false);

      expect(mocks.sceneDeps).toHaveLength(1);
      expect(h.bedScene.isHeld()).toBe(false);
    });

    it("gets her up by waking her as the backend", async () => {
      const h = setup({ enabled: false });
      h.start();
      await h.bedScene.bed.lieDown();

      h.bedScene.bed.getUp();

      expect(mocks.scene.wake).toHaveBeenCalledWith("agent");
    });

    it("maps the scene's state onto the phase the avatar commands read", async () => {
      const h = setup({ enabled: false });
      h.start();
      await h.bedScene.bed.lieDown();
      const phaseOf = (state: string) => {
        mocks.scene.state.mockReturnValue(state);
        return h.bedScene.bed.phase();
      };

      expect(phaseOf("starting")).toBe("starting");
      expect(phaseOf("asleep")).toBe("lying");
      expect(phaseOf("waking")).toBe("waking");
      // Done with the hold still on is the exit's tail, so she is not yet free.
      expect(phaseOf("done")).toBe("starting");
    });

    it("cannot run before the stage is wired, or with reduced motion on", async () => {
      const early = setup({ enabled: false });
      expect(early.bedScene.bed.phase()).toBe("unsupported");

      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const reduced = setup({ enabled: false });
      reduced.start();
      expect(reduced.bedScene.bed.phase()).toBe("unsupported");
      expect(await reduced.bedScene.bed.lieDown()).toBe(false);
      expect(mocks.sceneDeps).toEqual([]);
      expect(reduced.bedScene.isHeld()).toBe(false);
    });

    it("reports the launch hold as a scene starting before it has begun", () => {
      const h = setup();
      expect(h.bedScene.bed.phase()).toBe("starting");
    });
  });
});
