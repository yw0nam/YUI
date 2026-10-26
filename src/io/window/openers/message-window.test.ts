// @vitest-environment jsdom
/**
 * message-window.test.ts — on which runtime the message window opens.
 */

import { describe, expect, it, vi } from "vitest";
import { openMessageWindow } from "./message-window";

describe("openMessageWindow", () => {
  function env(overrides: Partial<Parameters<typeof openMessageWindow>[0]> = {}) {
    return {
      isTauri: true,
      getExisting: vi.fn(async () => null),
      create: vi.fn(async () => {}),
      resolvePosition: vi.fn(async () => ({ x: 10, y: 20 })),
      ...overrides,
    };
  }

  it("creates the window at the resolved position when none exists", async () => {
    const e = env();
    await openMessageWindow(e);
    expect(e.create).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("shows the existing window instead of creating a second one", async () => {
    const show = vi.fn(async () => {});
    const e = env({ getExisting: vi.fn(async () => ({ show })) });
    await openMessageWindow(e);
    expect(show).toHaveBeenCalledTimes(1);
    expect(e.create).not.toHaveBeenCalled();
  });

  it("does nothing outside Tauri", async () => {
    const e = env({ isTauri: false });
    await openMessageWindow(e);
    expect(e.getExisting).not.toHaveBeenCalled();
    expect(e.create).not.toHaveBeenCalled();
  });
});
