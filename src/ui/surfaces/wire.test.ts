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
vi.mock("../../io/bridge/message/message-bridge", () => ({ createMessageBridge }));
vi.mock("../../io/bridge/message/message-remote", () => ({ createRemoteSurfaces }));
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

function setup(mode: MessageWindowMode, bound = false) {
  const local = { dispose: vi.fn() };
  const remote = { dispose: vi.fn() };
  const surfaces = { dispose: vi.fn() };
  const bridge = { dispose: vi.fn() };
  const settings = { dispose: vi.fn(), emitSpeechStream: vi.fn() };
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
    boundId: bound ? "a" : null,
    settingsBridge: settings,
    transcript: { entriesAfterLastBoundary: () => [] },
    mount: {} as HTMLElement,
    tool: { showTool: vi.fn(), finishTool: vi.fn(), hideTool: vi.fn() },
    bubblePersistSettings: { get: () => ({ enabled: false }) },
    messageWindowSettings,
    register,
  });
  return {
    settings,
    result,
    register,
    local,
    remote,
    surfaces,
    bridge,
    modeDisposer,
    messageWindowSettings,
  };
}

describe("wireMessageSurfaces", () => {
  it("builds the bound remote half and targets its companion", () => {
    const { result, remote, surfaces, messageWindowSettings } = setup("popped", true);
    expect(result.surfaces).toBe(surfaces);
    expect(result.remote).toBe(remote);
    expect(createMessageWindowController).toHaveBeenCalledWith(messageWindowSettings, "a");
    expect(wireMessageWindowMode.mock.calls[0]![0].listenTrayToggle).toBeUndefined();
  });
  it("pins the effective mode to docked where there is no second window", () => {
    const { result } = setup("popped");

    expect(result.getMode()).toBe("docked");
  });

  it("returns the local, remote, and routed surfaces it built", () => {
    const { result, local, remote, surfaces } = setup("docked");

    expect(result.local).toBe(local);
    expect(result.remote).toBe(remote);
    expect(result.surfaces).toBe(surfaces);
    expect(wireMessageWindowMode.mock.calls[0]![0].listenTrayToggle).toBe(listenTrayToggle);
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

it("uses the window's existing bridge for identified speech without disposing it", () => {
  const { settings, register } = setup("docked", true);
  const stream = createSurfacesRouter.mock.calls[0]![0].stream;
  const identity = { turn_id: "7", event_name: "user.text_submitted" };
  stream.beginSpeech(identity);
  stream.pushSpeech("hi", identity);
  stream.endSpeech(undefined, identity);
  expect(settings.emitSpeechStream.mock.calls).toEqual([
    [{ preset: "a", turn_id: "7", op: "begin", baseline: 0 }],
    [{ preset: "a", turn_id: "7", op: "push", delta: "hi" }],
    [{ preset: "a", turn_id: "7", op: "end" }],
  ]);
  for (const [dispose] of register.mock.calls) dispose();
  expect(settings.dispose).not.toHaveBeenCalled();
});
