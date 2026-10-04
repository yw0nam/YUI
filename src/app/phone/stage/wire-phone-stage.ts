import type { AppConfig } from "../../../config/load";
import type { EventBus } from "../../../dispatcher/core/event-bus";
import { createTapSource } from "../../../dispatcher/sources/gesture/tap-source";
import { attachStageTouch } from "../../../io/stage/touch/stage-touch";
import { createTouchGesture } from "../../../io/stage/touch/touch-gesture";
import type { Renderer } from "../../../renderer";
import type { createCameraSettings } from "../../../settings/avatar/camera-settings";
import { createStageTap } from "./stage-tap";
import { createTouchCamera } from "./touch-camera";

/** The phone stage's touch camera and tap on top of the upper-body framing. */
export function wirePhoneStage(deps: {
  stage: HTMLElement;
  renderer: Pick<Renderer, "setFitBand" | "getTapPoints" | "getCurrentMotion">;
  cfg: AppConfig;
  bus: EventBus;
  cameraSettings: Pick<
    ReturnType<typeof createCameraSettings>,
    "get" | "setAzimuth" | "setPolar" | "setZoom"
  >;
}): () => void {
  deps.renderer.setFitBand(deps.cfg.avatar.framing.upper_body);
  const tapSource = createTapSource({
    bus: deps.bus,
    renderer: deps.renderer,
    config: deps.cfg.avatar.tap,
  });
  const gesture = createTouchGesture(
    createTouchCamera({
      cameraSettings: deps.cameraSettings,
      onTap: createStageTap({ stage: deps.stage, tapSource }),
    }),
  );
  return attachStageTouch(deps.stage, gesture);
}
