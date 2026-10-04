import type { TapSource } from "../../../dispatcher/sources/gesture/tap-source";
import { clientToStage } from "../../../renderer/geometry/hit/stage-coords";

/** Hands a tap to the tap source in stage-local px; the stage rect is read at tap time because the safe area and the visual viewport offset it. */
export function createStageTap(deps: {
  stage: Pick<HTMLElement, "getBoundingClientRect">;
  tapSource: Pick<TapSource, "handleClick">;
}): (pos: { x: number; y: number }) => void {
  return (pos) => {
    deps.tapSource.handleClick(clientToStage(pos.x, pos.y, deps.stage.getBoundingClientRect()));
  };
}
