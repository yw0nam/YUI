/** The stage's camera wiring — wheel zoom, persisted camera/throttle flow, and the feet-follow input anchor. */

import type { Renderer } from "../../renderer";
import { nextZoom } from "../../renderer/geometry/camera-fit";
import {
  CAMERA_WHEEL_SENSITIVITY,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
} from "../../settings/avatar/camera-settings";
import type { SettingsStores } from "../../settings/settings-stores";
import {
  INPUT_ANCHOR_EPSILON_PX,
  INPUT_ANCHOR_MIN_BOTTOM_PX,
  INPUT_FEET_GAP_PX,
  inputBottomFromAnchor,
} from "../../ui/surfaces/anchor";
import type { Surfaces } from "../../ui/surfaces/surfaces";

export function wireCamera(deps: {
  stage: HTMLElement;
  renderer: Pick<Renderer, "setZoom" | "setOrbit" | "setIdleThrottleEnabled">;
  cameraSettings: Pick<SettingsStores["cameraSettings"], "get" | "setZoom" | "subscribe">;
  idleThrottleSettings: Pick<SettingsStores["idleThrottleSettings"], "get" | "subscribe">;
}): () => void {
  // Character scale via mouse wheel: clamp bounds and sensitivity are io constants, persist is owned by store.
  // Drag uses pointerdown only, so no conflict with wheel (drag.ts).
  const onWheelZoom = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // ctrl+wheel is window-resize gesture (window-resize-source).
    e.preventDefault();
    const next = nextZoom(deps.cameraSettings.get().zoom, e.deltaY, {
      min: CAMERA_ZOOM_MIN,
      max: CAMERA_ZOOM_MAX,
      sensitivity: CAMERA_WHEEL_SENSITIVITY,
    });
    deps.cameraSettings.setZoom(next);
  };
  deps.stage.addEventListener("wheel", onWheelZoom, { passive: false });
  // Camera zoom: apply the persisted zoom ratio at boot, flow to the renderer on each change (wheel/cross-window).
  deps.renderer.setZoom(deps.cameraSettings.get().zoom);
  deps.renderer.setOrbit({
    azimuth: deps.cameraSettings.get().azimuth,
    polar: deps.cameraSettings.get().polar,
  });
  deps.cameraSettings.subscribe((s) => {
    deps.renderer.setZoom(s.zoom);
    deps.renderer.setOrbit({ azimuth: s.azimuth, polar: s.polar });
  });
  deps.renderer.setIdleThrottleEnabled(deps.idleThrottleSettings.get().enabled);
  deps.idleThrottleSettings.subscribe((s) => deps.renderer.setIdleThrottleEnabled(s.enabled));
  // Only the wheel listener is ours — the store subscribers die with the stores' own disposal.
  return () => deps.stage.removeEventListener("wheel", onWheelZoom);
}

export function wireInputAnchor(deps: {
  renderer: Pick<Renderer, "onTick" | "getCharacterAnchor">;
  stage: HTMLElement;
  surfaces: Pick<Surfaces, "setInputAnchor">;
}): () => void {
  // Anchor the chat input to the character's feet (follow reframe). Each frame, receive feet screen
  // coordinates, map to an input bottom offset, skip changes below epsilon to reduce var rewrites.
  let lastInputBottom: number | null = null;
  return deps.renderer.onTick(() => {
    const a = deps.renderer.getCharacterAnchor();
    if (!a) {
      if (lastInputBottom !== null) {
        deps.surfaces.setInputAnchor(null);
        lastInputBottom = null;
      }
      return;
    }
    const bottom = inputBottomFromAnchor(a.y, deps.stage.clientHeight || 1, {
      gap: INPUT_FEET_GAP_PX,
      minBottom: INPUT_ANCHOR_MIN_BOTTOM_PX,
    });
    if (lastInputBottom === null || Math.abs(bottom - lastInputBottom) > INPUT_ANCHOR_EPSILON_PX) {
      deps.surfaces.setInputAnchor(bottom);
      lastInputBottom = bottom;
    }
  });
}
