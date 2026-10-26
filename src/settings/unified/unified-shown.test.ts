import { describe, expect, it, vi } from "vitest";
import { createUnifiedShown } from "./unified-shown";

function setup(initial: { enabled: boolean; open: string[]; canOpen?: boolean }) {
  const state = { canOpen: true, ...initial };
  const switchListeners = new Set<(s: { enabled: boolean }) => void>();
  const windowListeners = new Set<() => void>();
  const shown = createUnifiedShown({
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
    canOpen: () => state.canOpen,
  });
  return {
    shown,
    flip: (enabled: boolean) => {
      state.enabled = enabled;
      for (const cb of switchListeners) cb({ enabled });
    },
    setOpen: (open: string[]) => {
      state.open = open;
      for (const cb of windowListeners) cb();
    },
    listeners: () => switchListeners.size + windowListeners.size,
  };
}

describe("createUnifiedShown", () => {
  it.each([
    { enabled: true, open: ["a", "b"], canOpen: true, expected: true },
    { enabled: false, open: ["a", "b"], canOpen: true, expected: false },
    { enabled: true, open: ["a"], canOpen: true, expected: false },
    { enabled: true, open: ["a", "b"], canOpen: false, expected: false },
  ])("is $expected with switch $enabled, $open.length open, canOpen $canOpen", (c) => {
    expect(setup(c).shown.get()).toBe(c.expected);
  });

  it("tells a subscriber once per change and not on an unchanged recompute", () => {
    const s = setup({ enabled: false, open: ["a", "b"] });
    const cb = vi.fn();
    s.shown.subscribe(cb);

    s.flip(true);
    s.setOpen(["a", "b", "c"]);
    s.setOpen(["a"]);

    expect(cb.mock.calls).toEqual([[true], [false]]);
  });

  it("stops following both sources once disposed", () => {
    const s = setup({ enabled: false, open: ["a", "b"] });

    s.shown.dispose();

    expect(s.listeners()).toBe(0);
  });
});
