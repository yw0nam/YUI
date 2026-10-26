import { describe, expect, it, vi } from "vitest";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";

const {
  createSettingsBridge,
  createSurfaces,
  createSurfacesRouter,
  createMessageBridge,
  createRemoteSurfaces,
  createMessageWindowController,
  listenTrayToggle,
  wireMessageWindowMode,
} = vi.hoisted(() => ({
  createSettingsBridge:
    vi.fn<typeof import("../../io/bridge/settings-bridge").createSettingsBridge>(),
  createSurfaces: vi.fn<typeof import("./surfaces").createSurfaces>(),
  createSurfacesRouter: vi.fn<typeof import("./surfaces-router").createSurfacesRouter>(),
  createMessageBridge:
    vi.fn<typeof import("../../io/bridge/message/message-bridge").createMessageBridge>(),
  createRemoteSurfaces:
    vi.fn<typeof import("../../io/bridge/message/message-remote").createRemoteSurfaces>(),
  createMessageWindowController:
    vi.fn<typeof import("../../io/window/openers/message-window").createMessageWindowController>(),
  listenTrayToggle:
    vi.fn<typeof import("../../io/window/openers/message-window").listenTrayToggle>(),
  wireMessageWindowMode:
    vi.fn<typeof import("../../io/window/openers/message-window-mode").wireMessageWindowMode>(),
}));

vi.mock("../../io/bridge/settings-bridge", () => ({ createSettingsBridge }));
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
  createSettingsBridge.mockReturnValue(settings as never);
  const modeDisposer = vi.fn();
  createSurfaces.mockReturnValue(local as never);
  createRemoteSurfaces.mockReturnValue(remote as never);
  createSurfacesRouter.mockReturnValue(surfaces as never);
  createMessageBridge.mockReturnValue(bridge as never);
  createMessageWindowController.mockReturnValue({ open: vi.fn(), hide: vi.fn() });
  wireMessageWindowMode.mockReturnValue(modeDisposer);
  const messageWindowSettings = fakeMessageWindowSettings(mode);
  const register = vi.fn();
  const result = wireMessageSurfaces({
    boundId: bound ? "a" : null,
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

    expect(register).toHaveBeenCalledTimes(4);
    const [settingsTeardown, bridgeTeardown, surfacesTeardown, modeTeardown] =
      register.mock.calls.map((call) => call[0]);

    settingsTeardown();
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

it("wires the bound preset's stream destination and disposes its settings bridge", () => {
  const { settings, register } = setup("docked", true);
  const stream = createSurfacesRouter.mock.calls[0]![0].stream;
  const identity = { turn_id: "7", event_name: "user.text_submitted" };
  stream.beginSpeech(identity);
  stream.pushSpeech("hi", identity);
  stream.endSpeech(undefined, identity);
  expect(settings.emitSpeechStream.mock.calls).toEqual([
    [{ preset: "a", turn_id: "7", op: "begin" }],
    [{ preset: "a", turn_id: "7", op: "push", delta: "hi" }],
    [{ preset: "a", turn_id: "7", op: "end" }],
  ]);
  for (const [dispose] of register.mock.calls) dispose();
  expect(settings.dispose).toHaveBeenCalledOnce();
});
