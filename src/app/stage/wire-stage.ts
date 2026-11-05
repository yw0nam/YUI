/** Wiring bound to the stage element and the renderer's view of it. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type { CursorSource } from "../../io/window/pet/cursor-source";
import { createHitTestController, type HitTestController } from "../../io/window/pet/hit-test";
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
  const interactiveRects = (): DOMRect[] => {
    const rects: DOMRect[] = [];
    for (const selector of INTERACTIVE_OVERLAY_SELECTORS) {
      for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        rects.push(el.getBoundingClientRect());
      }
    }
    return rects;
  };
  const pointInRect = (x: number, y: number, rect: DOMRect, margin: number): boolean =>
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin;
  const hitTest = createHitTestController({
    cursor,
    isOverInteractive: (xClient, yClient, marginPx) => {
      if (renderer.hitTest(xClient, yClient)) return true;
      return interactiveRects().some((rect) => pointInRect(xClient, yClient, rect, marginPx));
    },
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
