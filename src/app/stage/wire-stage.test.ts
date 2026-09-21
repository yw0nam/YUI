// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The wiring reaches isOverInteractive/onCursor only as factory options — mock the factories
// to capture the options they are created with and to stand in for the controllers.
const { createHitTestController, createCursorTracker } = vi.hoisted(() => ({
  createHitTestController: vi.fn(
    (_opts: {
      isOverInteractive: (x: number, y: number, marginPx: number) => boolean;
      moveTarget: EventTarget;
      getConfig: () => unknown;
    }) => ({}) as { start: () => void; stop: () => void },
  ),
  createCursorTracker: vi.fn(
    (_opts: { onCursor: (pos: { x: number; y: number } | null) => void }) =>
      ({}) as { start: () => void; stop: () => void },
  ),
}));

vi.mock("../../io/window/pet/hit-test", () => ({ createHitTestController }));
vi.mock("../../io/window/pet/cursor-tracker", () => ({ createCursorTracker }));

import type { HitTestKnobs } from "../../config/load";
import { INTERACTIVE_OVERLAY_SELECTORS, wireGaze, wireHitTest } from "./wire-stage";

const rectOf = (left: number, top: number, right: number, bottom: number): DOMRect =>
  ({ left, top, right, bottom }) as DOMRect;

const knobs = (): HitTestKnobs => ({
  hysteresis_margin_px: 10,
  poll_interval_ms: 50,
  debounce_samples: 2,
  alpha_threshold: 0.5,
});

const setupHitTest = (opts: {
  hit?: (x: number, y: number) => boolean;
  overlays?: Record<string, DOMRect>;
  quickControls?: { rect: DOMRect };
}) => {
  const controller = {
    start: vi.fn(),
    stop: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    setMoving: vi.fn(),
  };
  createHitTestController.mockImplementation(() => controller);
  let quickOpen = false;
  const querySelector = vi.fn((selector: string) => {
    const rect = opts.overlays?.[selector];
    return rect ? ({ getBoundingClientRect: () => rect } as unknown as HTMLElement) : null;
  });
  const hitTest = wireHitTest({
    root: { querySelector } as unknown as HTMLElement,
    renderer: { hitTest: opts.hit ?? (() => false) },
    getQuickControls: () => ({
      isOpen: () => quickOpen,
      el: {
        getBoundingClientRect: () => opts.quickControls?.rect ?? rectOf(0, 0, 0, 0),
      } as HTMLElement,
    }),
    getConfig: knobs,
  });
  return {
    hitTest,
    controller,
    querySelector,
    setQuickControlsOpen: (open: boolean) => {
      quickOpen = open;
    },
    isOverInteractive: createHitTestController.mock.calls[0][0].isOverInteractive,
  };
};

const setupGaze = (initialEnabled: boolean) => {
  const tracker = { start: vi.fn(), stop: vi.fn() };
  createCursorTracker.mockImplementation(() => tracker);
  const setGazeEnabled = vi.fn();
  const setGazeCursor = vi.fn();
  const unsubscribe = vi.fn();
  const subscribers = new Set<(state: { enabled: boolean }) => void>();
  let enabled = initialEnabled;
  const register = vi.fn((_teardown: () => void) => {});
  wireGaze({
    renderer: { setGazeEnabled, setGazeCursor },
    gazeSettings: {
      get: () => ({ enabled }),
      subscribe: (cb) => {
        subscribers.add(cb);
        return unsubscribe;
      },
    },
    register,
  });
  return {
    tracker,
    setGazeEnabled,
    setGazeCursor,
    unsubscribe,
    register,
    setEnabled: (next: boolean) => {
      enabled = next;
      for (const cb of subscribers) cb({ enabled: next });
    },
  };
};

describe("wireHitTest", () => {
  beforeEach(() => {
    createHitTestController.mockReset();
    createCursorTracker.mockReset();
  });

  it("counts a point on the character as interactive without any rect lookup", () => {
    const s = setupHitTest({ hit: () => true });
    expect(s.isOverInteractive(50, 60, 10)).toBe(true);
    expect(s.querySelector).not.toHaveBeenCalled();
  });

  it("counts a point inside an overlay's margin and rejects one outside it", () => {
    const s = setupHitTest({
      overlays: { [INTERACTIVE_OVERLAY_SELECTORS[0]]: rectOf(100, 100, 200, 140) },
    });
    expect(s.isOverInteractive(95, 120, 10)).toBe(true);
    expect(s.isOverInteractive(85, 120, 10)).toBe(false);
  });

  it("counts the quick-controls rect only while it is open", () => {
    const s = setupHitTest({ quickControls: { rect: rectOf(300, 300, 400, 340) } });
    s.setQuickControlsOpen(true);
    expect(s.isOverInteractive(310, 320, 0)).toBe(true);
    s.setQuickControlsOpen(false);
    expect(s.isOverInteractive(310, 320, 0)).toBe(false);
  });

  it("starts the controller and returns it", () => {
    const s = setupHitTest({});
    expect(s.controller.start).toHaveBeenCalledTimes(1);
    expect(s.hitTest).toBe(s.controller);
    expect(createHitTestController.mock.calls[0][0].moveTarget).toBe(window);
  });
});

describe("wireGaze", () => {
  beforeEach(() => {
    createHitTestController.mockReset();
    createCursorTracker.mockReset();
  });

  it("applies the store's enabled state at start and on every store change", () => {
    const s = setupGaze(true);
    expect(s.setGazeEnabled).toHaveBeenCalledWith(true);
    expect(s.tracker.start).toHaveBeenCalledTimes(1);
    s.setEnabled(false);
    expect(s.tracker.stop).toHaveBeenCalledTimes(1);
    expect(s.setGazeEnabled).toHaveBeenLastCalledWith(false);
    expect(s.setGazeCursor).toHaveBeenCalledWith(null);
  });

  it("registers the tracker stop first and the unsubscribe second", () => {
    const s = setupGaze(false);
    expect(s.register).toHaveBeenCalledTimes(2);
    expect(s.register.mock.calls[0][0]).toBe(s.tracker.stop);
    expect(s.register.mock.calls[1][0]).toBe(s.unsubscribe);
  });
});
