import { describe, expect, it, vi } from "vitest";
import { closeUnifiedWindow, openUnifiedWindow } from "./unified-window";

describe("openUnifiedWindow", () => {
  it("shows and focuses the window that exists instead of creating another", async () => {
    const existing = { show: vi.fn(async () => {}), setFocus: vi.fn(async () => {}) };
    const create = vi.fn(async () => {});

    await openUnifiedWindow({ isTauri: true, getExisting: async () => existing, create });

    expect(existing.show).toHaveBeenCalledOnce();
    expect(existing.setFocus).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the window when none exists", async () => {
    const create = vi.fn(async () => {});

    await openUnifiedWindow({ isTauri: true, getExisting: async () => null, create });

    expect(create).toHaveBeenCalledOnce();
  });

  it("does nothing outside Tauri", async () => {
    const getExisting = vi.fn(async () => null);
    const create = vi.fn(async () => {});

    await openUnifiedWindow({ isTauri: false, getExisting, create });

    expect(getExisting).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("closeUnifiedWindow", () => {
  it("destroys the window, so no close request reaches the window's own close handler", async () => {
    const existing = { destroy: vi.fn(async () => {}), close: vi.fn(async () => {}) };

    await closeUnifiedWindow({ isTauri: true, getExisting: async () => existing });

    expect(existing.destroy).toHaveBeenCalledOnce();
    expect(existing.close).not.toHaveBeenCalled();
  });
});
