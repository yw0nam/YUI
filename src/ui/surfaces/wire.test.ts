import { describe, expect, it, vi } from "vitest";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";

const {
  createSurfaces,
  createSurfacesRouter,
  createMessageBridge,
  createRemoteSurfaces,
  createMessageWindowController,
  listenTrayToggle,
  wireMessageWindowMode,
} = vi.hoisted(() => ({
  createSurfaces: vi.fn(),
  createSurfacesRouter: vi.fn(),
  createMessageBridge: vi.fn(),
  createRemoteSurfaces: vi.fn(),
  createMessageWindowController: vi.fn(),
  listenTrayToggle: vi.fn(),
  wireMessageWindowMode: vi.fn(),
}));

vi.mock("./surfaces", () => ({ createSurfaces }));
vi.mock("./surfaces-router", () => ({ createSurfacesRouter }));
vi.mock("../../io/bridge/message-bridge", () => ({ createMessageBridge }));
vi.mock("../../io/bridge/message-remote", () => ({ createRemoteSurfaces }));
vi.mock("../../io/window/openers/message-window", () => ({
  createMessageWindowController,
  listenTrayToggle,
}));
vi.mock("../../io/window/openers/message-window-mode", () => ({ wireMessageWindowMode }));

import { wireMessageSurfaces } from "./wire";

function fakeMessageWindowSettings(mode: MessageWindowMode) {
  return {
    get: () => ({ mode, x: null, y: null }),
    setMode: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

function setup(mode: MessageWindowMode) {
  const local = { dispose: vi.fn() };
  const remote = { dispose: vi.fn() };
  const surfaces = { dispose: vi.fn() };
  const bridge = { dispose: vi.fn() };
  const modeDisposer = vi.fn();
  createSurfaces.mockReturnValue(local);
  createRemoteSurfaces.mockReturnValue(remote);
  createSurfacesRouter.mockReturnValue(surfaces);
  createMessageBridge.mockReturnValue(bridge);
  createMessageWindowController.mockReturnValue({ open: vi.fn(), hide: vi.fn() });
  wireMessageWindowMode.mockReturnValue(modeDisposer);
  const messageWindowSettings = fakeMessageWindowSettings(mode);
  const register = vi.fn();
  const result = wireMessageSurfaces({
    mount: {} as HTMLElement,
    bubblePersistSettings: { get: () => ({ enabled: false }) },
    messageWindowSettings,
    register,
  });
  return { result, register, local, remote, surfaces, bridge, modeDisposer, messageWindowSettings };
}

describe("wireMessageSurfaces", () => {
  it("pins the effective mode to docked where there is no second window", () => {
    const { result } = setup("popped");

    expect(result.getMode()).toBe("docked");
  });

  it("returns the local, remote, and routed surfaces it built", () => {
    const { result, local, remote, surfaces } = setup("docked");

    expect(result.local).toBe(local);
    expect(result.remote).toBe(remote);
    expect(result.surfaces).toBe(surfaces);
  });

  it("registers the bridge, the router, then the window-mode teardown", () => {
    const { register, local, surfaces, bridge, modeDisposer } = setup("docked");

    expect(register).toHaveBeenCalledTimes(3);
    const [bridgeTeardown, surfacesTeardown, modeTeardown] = register.mock.calls.map(
      (call) => call[0],
    );

    bridgeTeardown();
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(surfaces.dispose).not.toHaveBeenCalled();

    surfacesTeardown();
    expect(surfaces.dispose).toHaveBeenCalledOnce();
    expect(local.dispose).not.toHaveBeenCalled();

    modeTeardown();
    expect(modeDisposer).toHaveBeenCalledOnce();
  });
});
