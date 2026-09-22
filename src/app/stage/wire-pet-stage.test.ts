// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { nextZoom } from "../../renderer/geometry/camera-fit";
import {
  CAMERA_WHEEL_SENSITIVITY,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
} from "../../settings/avatar/camera-settings";
import {
  INPUT_ANCHOR_EPSILON_PX,
  INPUT_ANCHOR_MIN_BOTTOM_PX,
  INPUT_FEET_GAP_PX,
  inputBottomFromAnchor,
} from "../../ui/surfaces/anchor";
import { wireCamera, wireInputAnchor } from "./wire-pet-stage";

function fakeCameraSettings(initial: { zoom: number; azimuth: number; polar: number }) {
  let state = { ...initial };
  const subs = new Set<(s: typeof state) => void>();
  return {
    get: () => state,
    setZoom: vi.fn((zoom: number) => {
      state = { ...state, zoom };
    }),
    subscribe: vi.fn((cb: (s: typeof state) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    change(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const cb of subs) cb(state);
    },
  };
}

function fakeThrottleSettings(initial: { enabled: boolean }) {
  let state = { ...initial };
  const subs = new Set<(s: typeof state) => void>();
  return {
    get: () => state,
    subscribe: vi.fn((cb: (s: typeof state) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    change(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const cb of subs) cb(state);
    },
  };
}

function wheelOn(stage: HTMLElement, opts: { deltaY: number; ctrlKey?: boolean }) {
  stage.dispatchEvent(
    new WheelEvent("wheel", { deltaY: opts.deltaY, ctrlKey: opts.ctrlKey, cancelable: true }),
  );
}

describe("wireCamera", () => {
  function setup() {
    const stage = document.createElement("div");
    const renderer = { setZoom: vi.fn(), setOrbit: vi.fn(), setIdleThrottleEnabled: vi.fn() };
    const cameraSettings = fakeCameraSettings({ zoom: 1.2, azimuth: 0.3, polar: 1.1 });
    const idleThrottleSettings = fakeThrottleSettings({ enabled: true });
    const removeWheel = wireCamera({ stage, renderer, cameraSettings, idleThrottleSettings });
    return { stage, renderer, cameraSettings, idleThrottleSettings, removeWheel };
  }

  it("applies the persisted camera and throttle at boot and on every change", () => {
    const { renderer, cameraSettings, idleThrottleSettings } = setup();

    expect(renderer.setZoom).toHaveBeenCalledWith(1.2);
    expect(renderer.setOrbit).toHaveBeenCalledWith({ azimuth: 0.3, polar: 1.1 });
    expect(renderer.setIdleThrottleEnabled).toHaveBeenCalledWith(true);

    cameraSettings.change({ zoom: 2, azimuth: 0.5, polar: 1.3 });
    idleThrottleSettings.change({ enabled: false });
    expect(renderer.setZoom).toHaveBeenLastCalledWith(2);
    expect(renderer.setOrbit).toHaveBeenLastCalledWith({ azimuth: 0.5, polar: 1.3 });
    expect(renderer.setIdleThrottleEnabled).toHaveBeenLastCalledWith(false);
  });

  it("ignores the ctrl+wheel window-resize gesture", () => {
    const { stage, cameraSettings } = setup();

    wheelOn(stage, { deltaY: -240, ctrlKey: true });

    expect(cameraSettings.setZoom).not.toHaveBeenCalled();
  });

  it("persists the zoomed wheel value into the camera store", () => {
    const { stage, cameraSettings } = setup();

    wheelOn(stage, { deltaY: -240 });

    expect(cameraSettings.setZoom).toHaveBeenCalledExactlyOnceWith(
      nextZoom(1.2, -240, {
        min: CAMERA_ZOOM_MIN,
        max: CAMERA_ZOOM_MAX,
        sensitivity: CAMERA_WHEEL_SENSITIVITY,
      }),
    );
  });

  it("removes only the wheel listener; the store subscribers die with the stores", () => {
    const { stage, renderer, cameraSettings, idleThrottleSettings, removeWheel } = setup();

    removeWheel();
    wheelOn(stage, { deltaY: -240 });
    expect(cameraSettings.setZoom).not.toHaveBeenCalled();

    cameraSettings.change({ zoom: 1.8 });
    idleThrottleSettings.change({ enabled: false });
    expect(renderer.setZoom).toHaveBeenLastCalledWith(1.8);
    expect(renderer.setIdleThrottleEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe("wireInputAnchor", () => {
  function setup() {
    const stage = document.createElement("div");
    Object.defineProperty(stage, "clientHeight", { value: 600, configurable: true });
    const unsub = vi.fn();
    const renderer = {
      onTick: vi.fn((_cb: () => void) => unsub),
      getCharacterAnchor: vi.fn<() => { x: number; y: number } | null>(() => null),
    };
    const setInputAnchor = vi.fn();
    const dispose = wireInputAnchor({ renderer, stage, surfaces: { setInputAnchor } });
    return {
      renderer,
      setInputAnchor,
      dispose,
      unsub,
      tick: renderer.onTick.mock.calls[0][0],
    };
  }

  it("anchors the input to the feet and skips sub-epsilon movement", () => {
    const { renderer, setInputAnchor, tick } = setup();
    const bottom = inputBottomFromAnchor(500, 600, {
      gap: INPUT_FEET_GAP_PX,
      minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX,
    });

    renderer.getCharacterAnchor.mockReturnValue({ x: 100, y: 500 });
    tick();
    expect(setInputAnchor).toHaveBeenNthCalledWith(1, bottom);

    renderer.getCharacterAnchor.mockReturnValue({ x: 100, y: 500 + INPUT_ANCHOR_EPSILON_PX - 0.1 });
    tick();
    expect(setInputAnchor).toHaveBeenCalledTimes(1);

    renderer.getCharacterAnchor.mockReturnValue({ x: 100, y: 490 });
    tick();
    expect(setInputAnchor).toHaveBeenNthCalledWith(
      2,
      inputBottomFromAnchor(490, 600, {
        gap: INPUT_FEET_GAP_PX,
        minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX,
      }),
    );
  });

  it("resets to null once when the anchor disappears and reapplies when it returns", () => {
    const { renderer, setInputAnchor, tick } = setup();

    renderer.getCharacterAnchor.mockReturnValue({ x: 0, y: 500 });
    tick();
    renderer.getCharacterAnchor.mockReturnValue(null);
    tick();
    tick();
    expect(setInputAnchor).toHaveBeenNthCalledWith(2, null);
    expect(setInputAnchor).toHaveBeenCalledTimes(2);

    renderer.getCharacterAnchor.mockReturnValue({ x: 0, y: 500 });
    tick();
    expect(setInputAnchor).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes the tick on dispose", () => {
    const { dispose, unsub } = setup();

    dispose();

    expect(unsub).toHaveBeenCalledOnce();
  });
});
