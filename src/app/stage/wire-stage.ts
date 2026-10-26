/** Wiring bound to the stage element and the renderer's view of it. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import { createCursorTracker } from "../../io/window/pet/cursor-tracker";
import { createHitTestController, type HitTestController } from "../../io/window/pet/hit-test";
import type { Renderer } from "../../renderer";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import type { QuickCard } from "../../ui/quick-card/quick-card";
import { INTERACTIVE_OVERLAY_SELECTORS } from "../../ui/surfaces/interactive-overlay";

export function wireHitTest(deps: {
  root: HTMLElement;
  renderer: Pick<Renderer, "hitTest">;
  /** While it is open, the whole window takes the pointer, so a click anywhere reaches the page and closes it. */
  getQuickCard: () => Pick<QuickCard, "isOpen">;
  getConfig: () => HitTestKnobs;
}): HitTestController {
  const { root, renderer, getQuickCard, getConfig } = deps;
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
    isOverInteractive: (xClient, yClient, marginPx) => {
      if (getQuickCard().isOpen() || renderer.hitTest(xClient, yClient)) return true;
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
  register: (teardown: () => void) => void;
}): void {
  const { renderer, gazeSettings, register } = deps;
  const cursorTracker = createCursorTracker({
    onCursor: (point) => renderer.setGazeCursor(point),
  });
  register(cursorTracker.stop);
  const applyGazeEnabled = (enabled: boolean): void => {
    renderer.setGazeEnabled(enabled);
    if (enabled) cursorTracker.start();
    else {
      cursorTracker.stop();
      renderer.setGazeCursor(null);
    }
  };
  applyGazeEnabled(gazeSettings.get().enabled);
  register(gazeSettings.subscribe((state) => applyGazeEnabled(state.enabled)));
}
