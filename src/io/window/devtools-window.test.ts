// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { type DevtoolsWindowEnv, openDevtoolsWindow } from "./devtools-window";

describe("openDevtoolsWindow", () => {
  it("routes Tauri runtimes to the webview opener", () => {
    const env: DevtoolsWindowEnv = {
      isTauri: true,
      createTauriWindow: vi.fn(),
      openBrowserWindow: vi.fn(),
    };

    openDevtoolsWindow(env);

    expect(env.createTauriWindow).toHaveBeenCalledOnce();
    expect(env.openBrowserWindow).not.toHaveBeenCalled();
  });

  it("routes browser runtimes to window.open", () => {
    const env: DevtoolsWindowEnv = {
      isTauri: false,
      createTauriWindow: vi.fn(),
      openBrowserWindow: vi.fn(),
    };

    openDevtoolsWindow(env);

    expect(env.openBrowserWindow).toHaveBeenCalledOnce();
    expect(env.createTauriWindow).not.toHaveBeenCalled();
  });
});
