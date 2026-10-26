import { describe, expect, it, vi } from "vitest";
import { orbitCamera } from "./camera-gestures";
import { CAMERA_ORBIT_SENSITIVITY } from "./camera-settings";

describe("orbitCamera", () => {
  it("turns the azimuth with dx and lowers the polar with dy", () => {
    const store = {
      get: () => ({ zoom: 1, azimuth: 0.2, polar: 1.4 }),
      setAzimuth: vi.fn(),
      setPolar: vi.fn(),
    };
    orbitCamera(store, { dx: 10, dy: -4 });
    expect(store.setAzimuth).toHaveBeenCalledWith(0.2 + 10 * CAMERA_ORBIT_SENSITIVITY);
    expect(store.setPolar).toHaveBeenCalledWith(1.4 + 4 * CAMERA_ORBIT_SENSITIVITY);
  });
});
