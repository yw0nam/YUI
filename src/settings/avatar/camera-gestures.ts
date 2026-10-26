/** Maps orbit moves onto the camera store. */
import { CAMERA_ORBIT_SENSITIVITY, type createCameraSettings } from "./camera-settings";

/** Per-move pointer delta in CSS px. */
export interface OrbitDelta {
  dx: number;
  dy: number;
}

type OrbitStore = Pick<ReturnType<typeof createCameraSettings>, "get" | "setAzimuth" | "setPolar">;

/** Nudges the orbit by one pointer move: right turns the azimuth up, down lowers the polar. */
export function orbitCamera(store: OrbitStore, delta: OrbitDelta): void {
  const current = store.get();
  store.setAzimuth(current.azimuth + delta.dx * CAMERA_ORBIT_SENSITIVITY);
  store.setPolar(current.polar - delta.dy * CAMERA_ORBIT_SENSITIVITY);
}
