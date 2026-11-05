// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The wiring reaches isOverInteractive only as a factory option — mock the factory to capture the
// options it is created with and to stand in for the controller.
const { createHitTestController } = vi.hoisted(() => ({
  createHitTestController:
    vi.fn<typeof import("../../io/window/pet/hit-test").createHitTestController>(),
}));

vi.mock("../../io/window/pet/hit-test", () => ({ createHitTestController }));

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import { INTERACTIVE_OVERLAY_SELECTORS } from "../../ui/surfaces/interactive-overlay";
import { wireGaze, wireHitTest } from "./wire-stage";

const rectOf = (left: number, top: number, right: number, bottom: number): DOMRect =>
  ({ left, top, right, bottom }) as DOMRect;

const knobs = (): HitTestKnobs => ({
  hysteresis_margin_px: 10,
  poll_interval_ms: 50,
  debounce_samples: 2,
  alpha_threshold: 0.5,
});

type Cursor = { x: number; y: number } | null;

const fakeCursor = () => {
  const listeners = new Set<(pos: Cursor) => void>();
  return {
    listeners,
    subscribe: vi.fn((listener: (pos: Cursor) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }),
    setMoving: vi.fn(),
  };
};

const setupHitTest = (opts: {
  hit?: (x: number, y: number) => boolean;
  overlays?: Record<string, DOMRect[]>;
}) => {
  const controller = {
    start: vi.fn(),
    stop: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    setMoving: vi.fn(),
  };
  createHitTestController.mockImplementation(() => controller);
  const cursor = fakeCursor();
  const querySelectorAll = vi.fn((selector: string) =>
    (opts.overlays?.[selector] ?? []).map(
      (rect) => ({ getBoundingClientRect: () => rect }) as unknown as HTMLElement,
    ),
  );
  const hitTest = wireHitTest({
    root: { querySelectorAll } as unknown as HTMLElement,
    renderer: { hitTest: opts.hit ?? (() => false) },
    cursor,
    getConfig: knobs,
  });
  return {
    hitTest,
    controller,
    cursor,
    querySelectorAll,
    isOverInteractive: createHitTestController.mock.calls[0][0].isOverInteractive,
  };
};

const setupGaze = (initialEnabled: boolean) => {
  const cursor = fakeCursor();
  const setGazeEnabled = vi.fn();
  const setGazeCursor = vi.fn();
  const settingsSubscribers = new Set<(state: { enabled: boolean }) => void>();
  let enabled = initialEnabled;
  const teardowns: Array<() => void> = [];
  wireGaze({
    renderer: { setGazeEnabled, setGazeCursor },
    gazeSettings: {
      get: () => ({ enabled }),
      subscribe: (cb) => {
        settingsSubscribers.add(cb);
        return () => void settingsSubscribers.delete(cb);
      },
    },
    cursor,
    register: (teardown) => void teardowns.push(teardown),
  });
  return {
    listeners: cursor.listeners,
    setGazeEnabled,
    setGazeCursor,
    settingsSubscribers,
    teardown: () => {
      for (const t of teardowns) t();
    },
    setEnabled: (next: boolean) => {
      enabled = next;
      for (const cb of settingsSubscribers) cb({ enabled: next });
    },
  };
};

describe("wireHitTest", () => {
  it("counts a point on the character as interactive without any rect lookup", () => {
    const s = setupHitTest({ hit: () => true });
    expect(s.isOverInteractive(50, 60, 10)).toBe(true);
    expect(s.querySelectorAll).not.toHaveBeenCalled();
  });

  it("counts a point inside an overlay's margin and rejects one outside it", () => {
    const s = setupHitTest({
      overlays: { [INTERACTIVE_OVERLAY_SELECTORS[0]]: [rectOf(100, 100, 200, 140)] },
    });
    expect(s.isOverInteractive(95, 120, 10)).toBe(true);
    expect(s.isOverInteractive(85, 120, 10)).toBe(false);
  });

  // One selector can name several targets, such as the bubble's two edge buttons.
  it("counts every element a selector matches, not only the first", () => {
    const s = setupHitTest({
      overlays: {
        [INTERACTIVE_OVERLAY_SELECTORS[0]]: [
          rectOf(100, 100, 120, 120),
          rectOf(130, 100, 150, 120),
        ],
      },
    });
    expect(s.isOverInteractive(140, 110, 0)).toBe(true);
  });

  it("starts the controller on the given cursor source and returns it", () => {
    const s = setupHitTest({});
    expect(s.controller.start).toHaveBeenCalledTimes(1);
    expect(s.hitTest).toBe(s.controller);
    const opts = createHitTestController.mock.calls[0][0];
    expect(opts.moveTarget).toBe(window);
    expect(opts.cursor).toBe(s.cursor);
  });
});

describe("wireGaze", () => {
  it("subscribes the gaze cursor while gaze is on and clears it when turned off", () => {
    const s = setupGaze(true);
    expect(s.setGazeEnabled).toHaveBeenCalledWith(true);
    expect(s.listeners.size).toBe(1);
    for (const listener of s.listeners) listener({ x: 3, y: 4 });
    expect(s.setGazeCursor).toHaveBeenCalledWith({ x: 3, y: 4 });

    s.setEnabled(false);
    expect(s.listeners.size).toBe(0);
    expect(s.setGazeEnabled).toHaveBeenLastCalledWith(false);
    expect(s.setGazeCursor).toHaveBeenLastCalledWith(null);

    s.setEnabled(true);
    expect(s.listeners.size).toBe(1);
  });

  it("teardown releases the gaze subscription and the settings subscription", () => {
    const s = setupGaze(true);
    s.teardown();
    expect(s.listeners.size).toBe(0);
    expect(s.settingsSubscribers.size).toBe(0);
  });
});
