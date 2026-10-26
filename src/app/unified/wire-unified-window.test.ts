import { describe, expect, it, vi } from "vitest";
import { wireUnifiedWindow } from "./wire-unified-window";

function setup(initial: boolean) {
  let value = initial;
  const listeners = new Set<(shown: boolean) => void>();
  const win = { open: vi.fn(), close: vi.fn() };
  const dispose = wireUnifiedWindow({
    shown: {
      get: () => value,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    window: win,
  });
  return {
    win,
    dispose,
    set: (next: boolean) => {
      value = next;
      for (const cb of listeners) cb(next);
    },
    listeners: () => listeners.size,
  };
}

describe("wireUnifiedWindow", () => {
  it("opens when the window becomes shown", () => {
    const s = setup(false);
    expect(s.win.open).not.toHaveBeenCalled();

    s.set(true);

    expect(s.win.open).toHaveBeenCalledOnce();
  });

  it("opens at once when it is shown from the start", () => {
    const s = setup(true);

    expect(s.win.open).toHaveBeenCalledOnce();
  });

  it("closes when it stops being shown", () => {
    const s = setup(true);

    s.set(false);

    expect(s.win.close).toHaveBeenCalled();
  });

  it("stops following the predicate once disposed", () => {
    const s = setup(false);

    s.dispose();

    expect(s.listeners()).toBe(0);
  });
});
