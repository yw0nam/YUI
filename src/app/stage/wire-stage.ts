/** Wiring bound to the stage element and the renderer's view of it. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type { CursorSource } from "../../io/window/pet/cursor-source";
import { createHitTestController, type HitTestController } from "../../io/window/pet/hit-test";
import { overSelectors } from "../../io/window/pet/over-selectors";
import type { Renderer } from "../../renderer";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import { INTERACTIVE_OVERLAY_SELECTORS } from "../../ui/surfaces/interactive-overlay";

export function wireHitTest(deps: {
  root: HTMLElement;
  renderer: Pick<Renderer, "hitTest">;
  cursor: CursorSource;
  getConfig: () => HitTestKnobs;
}): HitTestController {
  const { root, renderer, cursor, getConfig } = deps;
  const hitTest = createHitTestController({
    cursor,
    isOverInteractive: (xClient, yClient, marginPx) =>
      renderer.hitTest(xClient, yClient) ||
      overSelectors(root, INTERACTIVE_OVERLAY_SELECTORS, xClient, yClient, marginPx),
    moveTarget: window,
    getConfig,
  });
  hitTest.start();
  return hitTest;
}

export function wireGaze(deps: {
  renderer: Pick<Renderer, "setGazeEnabled" | "setGazeCursor">;
  gazeSettings: Pick<FlagSettingsStore, "get" | "subscribe">;
  cursor: Pick<CursorSource, "subscribe">;
  register: (teardown: () => void) => void;
}): void {
  const { renderer, gazeSettings, cursor, register } = deps;
  let stopGaze: (() => void) | null = null;
  const applyGazeEnabled = (enabled: boolean): void => {
    renderer.setGazeEnabled(enabled);
    if (enabled) {
      stopGaze ??= cursor.subscribe((point) => renderer.setGazeCursor(point));
    } else {
      stopGaze?.();
      stopGaze = null;
      renderer.setGazeCursor(null);
    }
  };
  applyGazeEnabled(gazeSettings.get().enabled);
  register(() => stopGaze?.());
  register(gazeSettings.subscribe((state) => applyGazeEnabled(state.enabled)));
}
