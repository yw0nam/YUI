import { describe, expect, it, vi } from "vitest";
import { CAMERA_ORBIT_SENSITIVITY } from "../../settings/avatar/camera-settings";

// initDrag is faked so each test can drive the callbacks wireStageGestures hands it and
// assert the disposer it returns is registered.
const { initDrag } = vi.hoisted(() => ({ initDrag: vi.fn() }));

vi.mock("../../io/window/pet/drag", () => ({ initDrag }));

import { createPatGesture, wireStageGestures } from "./wire-gestures";

describe("createPatGesture", () => {
  function harness() {
    const hitTest = { suspend: vi.fn(), resume: vi.fn() };
    const tapSource = {
      isHeadPoint: vi.fn(() => true),
      handlePatStart: vi.fn(),
      handlePatEnd: vi.fn(),
      handlePatAbort: vi.fn(),
    };
    return { hitTest, tapSource, pat: createPatGesture({ hitTest, tapSource, holdMs: () => 300 }) };
  }

  it("suspends the click-through hit-test for the length of the pat", () => {
    const { hitTest, tapSource, pat } = harness();

    pat.onStart();
    expect(hitTest.suspend).toHaveBeenCalledTimes(1);
    expect(hitTest.resume).not.toHaveBeenCalled();
    expect(tapSource.handlePatStart).toHaveBeenCalledTimes(1);

    pat.onEnd();
    expect(hitTest.resume).toHaveBeenCalledTimes(1);
    expect(tapSource.handlePatEnd).toHaveBeenCalledTimes(1);
  });

  it("resumes the hit-test when the pat is aborted", () => {
    const { hitTest, tapSource, pat } = harness();

    pat.onStart();
    pat.onAbort();
    expect(hitTest.resume).toHaveBeenCalledTimes(1);
    expect(tapSource.handlePatAbort).toHaveBeenCalledTimes(1);
    expect(tapSource.handlePatEnd).not.toHaveBeenCalled();
  });

  it("classifies the press point through the tap source and reads the hold live", () => {
    const { tapSource, pat } = harness();

    expect(pat.isPatPoint({ x: 5, y: 6 })).toBe(true);
    expect(tapSource.isHeadPoint).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(pat.holdMs()).toBe(300);
  });
});

describe("wireStageGestures", () => {
  const setup = async () => {
    const order: string[] = [];
    const registered: Array<() => void> = [];
    const disposer = vi.fn();
    let dragOpts:
      | {
          onDragStart?: () => void | Promise<void>;
          onDragEnd?: () => void;
          onOrbit?: (delta: { dx: number; dy: number }) => void;
        }
      | undefined;
    initDrag.mockImplementation(async (_stage: unknown, opts: typeof dragOpts) => {
      dragOpts = opts;
      return disposer;
    });

    let azimuth = 0.2;
    let polar = 1.4;
    const cameraSettings = {
      get: vi.fn(() => ({ zoom: 1, azimuth, polar })),
      setAzimuth: vi.fn((next: number) => {
        azimuth = next;
      }),
      setPolar: vi.fn((next: number) => {
        polar = next;
      }),
    };
    const travelAbort = Promise.resolve();
    const locomotion = {
      setDragging: vi.fn((dragging: boolean) => order.push(`setDragging:${dragging}`)),
      cancel: vi.fn(() => order.push("cancel")),
      dropSource: {
        noteUserDrag: vi.fn(() => order.push("noteUserDrag")),
        noteUserDragEnd: vi.fn(() => order.push("noteUserDragEnd")),
      },
      abortTravel: vi.fn(() => travelAbort),
    };
    const hitTest = {
      suspend: vi.fn(() => order.push("suspend")),
      resume: vi.fn(() => order.push("resume")),
    };
    const bus = { push: vi.fn() };

    await wireStageGestures({
      stage: {} as HTMLElement,
      bus: bus as never,
      renderer: {} as never,
      ambient: {} as never,
      getConfig: () =>
        ({
          avatar: {
            tap: { pat_hold_ms: 300 },
            drag_hold_ms: 500,
            gesture_cues: { drag_held: {} },
          },
        }) as never,
      drainSignals: () => [],
      hitTest,
      locomotion,
      cameraSettings: cameraSettings as never,
      register: (teardown: () => void) => {
        registered.push(teardown);
      },
    });

    return {
      order,
      registered,
      disposer,
      dragOpts: dragOpts!,
      bus,
      hitTest,
      locomotion,
      cameraSettings,
      travelAbort,
    };
  };

  it("on drag start cancels locomotion, suspends the hit-test and returns the travel abort", async () => {
    const s = await setup();

    const result = s.dragOpts.onDragStart!();

    expect(s.order).toEqual(["setDragging:true", "cancel", "suspend", "noteUserDrag"]);
    expect(s.bus.push).toHaveBeenCalledTimes(1);
    expect(s.bus.push).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "os_event_watcher",
        event_name: "user.drag_start",
        hint_tier: 1,
        dnd_override: true,
      }),
    );
    // The drag start hands the OS drag the still-unparking travel's abort promise itself.
    expect(result).toBe(s.travelAbort);
  });

  it("on drag end resumes the hit-test and reports the release", async () => {
    const s = await setup();

    s.dragOpts.onDragEnd!();

    expect(s.order).toEqual(["setDragging:false", "resume", "noteUserDragEnd"]);
    expect(s.bus.push).toHaveBeenCalledTimes(1);
    expect(s.bus.push).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "os_event_watcher",
        event_name: "user.drag_end",
        hint_tier: 1,
        dnd_override: true,
      }),
    );
  });

  it("orbits the camera by the pointer delta times the sensitivity", async () => {
    const s = await setup();

    s.dragOpts.onOrbit!({ dx: 20, dy: -10 });

    expect(s.cameraSettings.setAzimuth).toHaveBeenCalledWith(0.2 + 20 * CAMERA_ORBIT_SENSITIVITY);
    expect(s.cameraSettings.setPolar).toHaveBeenCalledWith(1.4 - -10 * CAMERA_ORBIT_SENSITIVITY);
  });

  it("registers initDrag's disposer", async () => {
    const s = await setup();

    expect(s.disposer).not.toHaveBeenCalled();
    for (const teardown of s.registered) teardown();
    expect(s.disposer).toHaveBeenCalledTimes(1);
  });
});
