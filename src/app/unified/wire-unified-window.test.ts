import { describe, expect, it, vi } from "vitest";
import { wireUnifiedWindow } from "./wire-unified-window";

function setup(initial: { enabled: boolean; open: string[] }) {
  const state = { ...initial };
  const switchListeners = new Set<() => void>();
  const windowListeners = new Set<() => void>();
  const win = { open: vi.fn(), close: vi.fn() };
  const dispose = wireUnifiedWindow({
    switch: {
      get: () => ({ enabled: state.enabled }),
      subscribe: (cb) => {
        switchListeners.add(cb);
        return () => switchListeners.delete(cb);
      },
    },
    openPresetIds: () => state.open,
    onPetWindowsChanged: (cb) => {
      windowListeners.add(cb);
      return () => windowListeners.delete(cb);
    },
    window: win,
  });
  return {
    win,
    dispose,
    flip: (enabled: boolean) => {
      state.enabled = enabled;
      for (const cb of switchListeners) cb();
    },
    setOpen: (open: string[]) => {
      state.open = open;
      for (const cb of windowListeners) cb();
    },
    listeners: () => switchListeners.size + windowListeners.size,
  };
}

describe("wireUnifiedWindow", () => {
  it("opens when the switch turns on with two presets open", () => {
    const s = setup({ enabled: false, open: ["a", "b"] });
    expect(s.win.open).not.toHaveBeenCalled();

    s.flip(true);

    expect(s.win.open).toHaveBeenCalledOnce();
  });

  it("opens when a second preset opens while the switch is on", () => {
    const s = setup({ enabled: true, open: ["a"] });
    expect(s.win.open).not.toHaveBeenCalled();

    s.setOpen(["a", "b"]);

    expect(s.win.open).toHaveBeenCalledOnce();
  });

  it("closes when one preset is left", () => {
    const s = setup({ enabled: true, open: ["a", "b"] });
    expect(s.win.open).toHaveBeenCalledOnce();

    s.setOpen(["a"]);

    expect(s.win.close).toHaveBeenCalled();
  });

  it("closes when the switch turns off", () => {
    const s = setup({ enabled: true, open: ["a", "b"] });

    s.flip(false);

    expect(s.win.close).toHaveBeenCalled();
  });

  it("stops following both sources once disposed", () => {
    const s = setup({ enabled: false, open: ["a", "b"] });

    s.dispose();

    expect(s.listeners()).toBe(0);
  });
});
