import type { TouchGestureCallbacks } from "../../../io/stage/touch/touch-gesture";
import { orbitCamera, pinchZoomCamera } from "../../../settings/avatar/camera-gestures";
import type { createCameraSettings } from "../../../settings/avatar/camera-settings";

/** Binds the stage gestures to the camera store: a pinch scales the zoom captured when the second finger landed. */
export function createTouchCamera(deps: {
  cameraSettings: Pick<
    ReturnType<typeof createCameraSettings>,
    "get" | "setAzimuth" | "setPolar" | "setZoom"
  >;
  onTap: (pos: { x: number; y: number }) => void;
}): TouchGestureCallbacks {
  const { cameraSettings } = deps;
  let baseZoom = cameraSettings.get().zoom;
  return {
    onOrbit: (delta) => orbitCamera(cameraSettings, delta),
    onPinchStart: () => {
      baseZoom = cameraSettings.get().zoom;
    },
    onPinch: (ratio) => pinchZoomCamera(cameraSettings, baseZoom, ratio),
    onTap: deps.onTap,
  };
}
