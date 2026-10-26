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
  let name = "Yui";
  const nameListeners: Array<() => void> = [];
  const offName = vi.fn();
  const characterName = {
    get: () => name,
    subscribe: (cb: () => void) => {
      nameListeners.push(cb);
      return offName;
    },
  };
  const rename = (next: string): void => {
    name = next;
    for (const cb of nameListeners) cb();
  };
  const local = { dispose: vi.fn() };
  const remote = { dispose: vi.fn(), setName: vi.fn() };
  const surfaces = { dispose: vi.fn() };
  const bridge = { dispose: vi.fn() };
  const settings = {
    dispose: vi.fn(),
    emitSpeechStream: vi.fn(),
    onSpeechStreamAsk: vi.fn(() => () => {}),
    onSpeechStreamControl: vi.fn(() => () => {}),
  };
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
    characterName,
    mount: {} as HTMLElement,
    tool: { showTool: vi.fn(), finishTool: vi.fn(), hideTool: vi.fn() },
    bubblePersistSettings: { get: () => ({ enabled: false }) },
    messageWindowSettings,
    shown: { get: () => false, subscribe: () => () => {} },
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
    rename,
    offName,
  };
}

describe("wireMessageSurfaces", () => {
  it("sends the character's name to the message window, and again when it changes", () => {
    const { remote, rename } = setup("popped");
    expect(remote.setName).toHaveBeenLastCalledWith("Yui");
    rename("Perlica");
    expect(remote.setName).toHaveBeenLastCalledWith("Perlica");
  });

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

  it("registers the name subscription, the bridge, the router, the stream, then the window-mode teardown", () => {
    const { register, local, remote, surfaces, bridge, modeDisposer, offName } = setup("docked");

    expect(register).toHaveBeenCalledTimes(5);
    const [nameTeardown, bridgeTeardown, surfacesTeardown, streamTeardown, modeTeardown] =
      register.mock.calls.map((call) => call[0]);
    expect(nameTeardown).toBe(offName);

    bridgeTeardown();
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(surfaces.dispose).not.toHaveBeenCalled();

    surfacesTeardown();
    expect(surfaces.dispose).toHaveBeenCalledOnce();
    expect(local.dispose).not.toHaveBeenCalled();

    streamTeardown();
    expect(remote.dispose).toHaveBeenCalledOnce();

    modeTeardown();
    expect(modeDisposer).toHaveBeenCalledOnce();
  });
});

it("sends the stream half's ops over the window's bridge, stamped with the preset, without disposing it", () => {
  const { settings, register } = setup("docked", true);
  const streamBridge = createRemoteSurfaces.mock.calls[1]![0];

  streamBridge.emitSurface({ op: "begin" });

  expect(settings.emitSpeechStream).toHaveBeenCalledExactlyOnceWith({
    preset: "a",
    op: { op: "begin" },
  });
  for (const [dispose] of register.mock.calls) dispose();
  expect(settings.dispose).not.toHaveBeenCalled();
});
