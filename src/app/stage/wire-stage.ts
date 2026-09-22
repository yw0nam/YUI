/** Wiring bound to the stage element and the renderer's view of it. */

import type { HitTestKnobs } from "../../config/load";
import { createCursorTracker } from "../../io/window/pet/cursor-tracker";
import { createHitTestController, type HitTestController } from "../../io/window/pet/hit-test";
import type { Renderer } from "../../renderer";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import type { createQuickControls } from "../../ui/quick-controls/quick-controls";

/**
 * Overlay elements that must take OS pointer events while shown — everything else in the overlay
 * stays click-through. The bubble itself is display-only; only its dismiss button is a target.
 * The voice chip earns pointer events only in the one state where it has a fix to offer.
 */
export const INTERACTIVE_OVERLAY_SELECTORS = [
  ".yui-input.is-open",
  ".yui-bubble.is-visible .yui-bubble__close",
  ".yui-bubble.is-visible .yui-bubble__pop",
  '.yui-voice.is-visible[data-fix="settings"]',
  ".yui-deleg.is-visible .yui-deleg__chip",
  ".yui-deleg.is-visible .yui-deleg__list.is-open",
] as const;

export function wireHitTest(deps: {
  root: HTMLElement;
  renderer: Pick<Renderer, "hitTest">;
  getQuickControls: () => Pick<ReturnType<typeof createQuickControls>, "isOpen" | "el">;
  getConfig: () => HitTestKnobs;
}): HitTestController {
  const { root, renderer, getQuickControls, getConfig } = deps;
  const interactiveRects = (): DOMRect[] => {
    const rects: DOMRect[] = [];
    for (const selector of INTERACTIVE_OVERLAY_SELECTORS) {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) rects.push(el.getBoundingClientRect());
    }
    const quickControls = getQuickControls();
    if (quickControls.isOpen()) rects.push(quickControls.el.getBoundingClientRect());
    return rects;
  };
  const pointInRect = (x: number, y: number, rect: DOMRect, margin: number): boolean =>
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin;
  const hitTest = createHitTestController({
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
