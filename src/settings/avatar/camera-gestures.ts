/** Maps orbit moves and pinch ratios onto the camera store. */
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

type ZoomStore = Pick<ReturnType<typeof createCameraSettings>, "setZoom">;

/** Sets the zoom a pinch reached: the zoom at pinch start times the spread ratio; the store clamps. */
export function pinchZoomCamera(store: ZoomStore, baseZoom: number, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  store.setZoom(baseZoom * ratio);
}
