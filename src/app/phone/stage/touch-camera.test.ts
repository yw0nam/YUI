import { describe, expect, it, vi } from "vitest";
import { CAMERA_ORBIT_SENSITIVITY } from "../../../settings/avatar/camera-settings";
import { createTouchCamera } from "./touch-camera";

function makeStore(zoom: number) {
  const state = { zoom, azimuth: 0, polar: Math.PI / 2 };
  return {
    state,
    get: () => ({ ...state }),
    setZoom: vi.fn<(z: number) => void>(),
    setAzimuth: vi.fn<(a: number) => void>(),
    setPolar: vi.fn<(p: number) => void>(),
  };
}

describe("createTouchCamera", () => {
  it("scales the zoom captured at pinch start without compounding", () => {
    const store = makeStore(1.5);
    const cb = createTouchCamera({ cameraSettings: store, onTap: vi.fn() });

    cb.onPinchStart();
    cb.onPinch(2);
    expect(store.setZoom).toHaveBeenLastCalledWith(3);
    cb.onPinch(2);
    expect(store.setZoom).toHaveBeenLastCalledWith(3);

    store.state.zoom = 3;
    cb.onPinchStart();
    cb.onPinch(0.5);
    expect(store.setZoom).toHaveBeenLastCalledWith(1.5);
  });

  it("routes an orbit to the store and a tap to onTap", () => {
    const store = makeStore(1);
    const onTap = vi.fn();
    const cb = createTouchCamera({ cameraSettings: store, onTap });

    cb.onOrbit({ dx: 10, dy: 0 });
    expect(store.setAzimuth).toHaveBeenCalledWith(10 * CAMERA_ORBIT_SENSITIVITY);
    cb.onTap({ x: 5, y: 6 });
    expect(onTap).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
});
