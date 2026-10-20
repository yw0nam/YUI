// @vitest-environment jsdom
// The pet window's boot wiring: what it hands the preset switch.

import { afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const windowBridge = { name: "pet window settings bridge" };
  const stopTurn = (): void => {};
  return { windowBridge, stopTurn };
});

vi.mock("../styles.css", () => ({}));
vi.mock("../logger", () => ({
  initLogger: vi.fn(async () => {}),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock("../app/bootstrap-configured", () => ({ createConfiguredBootstrap: vi.fn() }));
vi.mock("../app/dev/wire-dev-globals", () => ({ wireDevGlobals: vi.fn() }));
vi.mock("../app/stage/stage-renderer", () => ({
  createStageRenderer: vi.fn(() => ({ renderer: {}, ambient: {} })),
}));
vi.mock("../app/stage/wire-pet-stage", () => ({ wireInputAnchor: vi.fn(() => () => {}) }));
vi.mock("../ui/chips/status-pill", () => ({
  createStatusPill: vi.fn(() => ({ dispose: vi.fn() })),
}));
vi.mock("../ui/surfaces/wire", () => ({
  wireMessageSurfaces: vi.fn(() => ({ surfaces: {}, local: {}, remote: {}, getMode: vi.fn() })),
}));
vi.mock("../io/window/capture/tauri-screen", () => ({
  resolveScreenCapturer: vi.fn(),
  resolveScreenSourceProvider: vi.fn(),
}));
vi.mock("../io/window/openers/settings-window", () => ({ createSettingsWindowOpener: vi.fn() }));
vi.mock("../io/window/openers/devtools-window", () => ({ createDevtoolsWindowOpener: vi.fn() }));
vi.mock("../app/cross-window/wire-cross-window", () => ({
  wireCrossWindowSync: vi.fn(() => ({
    broadcastSettings: vi.fn(),
    onRemoteChange: vi.fn(),
    bridge: h.windowBridge,
    dispose: vi.fn(),
  })),
}));
vi.mock("../app/settings/wire-avatar", () => ({
  wireAvatarSelection: vi.fn(() => ({ vrm: {}, speaker: {} })),
}));
vi.mock("../app/cross-window/wire-window-sync", () => ({ wireSettingsReload: vi.fn() }));
vi.mock("../app/turn/push/push-stores", () => ({
  createPushStores: vi.fn(() => ({ stopTurn: h.stopTurn })),
  publishPushStores: vi.fn(),
}));
vi.mock("../app/settings/wire-preset", () => ({ wirePresetSwitch: vi.fn(() => () => {}) }));
vi.mock("../app/controls/wire-help-guide", () => ({ wireHelpGuide: vi.fn(() => ({})) }));
vi.mock("../app/controls/wire-pet-controls", () => ({ wirePetControls: vi.fn(() => ({})) }));
vi.mock("../ui/surfaces/summon-key", () => ({ attachSummonKey: vi.fn(() => () => {}) }));
// Config load fails, so the boot ends on the error card right after the wiring under test.
vi.mock("../app/settings/wire-config", () => ({
  createPetConfig: vi.fn(() => ({
    config: { load: vi.fn(async () => Promise.reject(new Error("no configs"))) },
  })),
  wireConfigReload: vi.fn(),
  wireConfigWatch: vi.fn(),
}));
vi.mock("../ui/notices/boot-error", () => ({ showBootError: vi.fn() }));

afterEach(() => {
  localStorage.clear();
});

it("hands the preset switch the stop button's stopTurn and the window's settings bridge", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const { wirePresetSwitch } = await import("../app/settings/wire-preset");
  const { showBootError } = await import("../ui/notices/boot-error");

  await import("./main");
  await vi.waitFor(() => expect(showBootError).toHaveBeenCalledOnce());

  expect(wirePresetSwitch).toHaveBeenCalledWith(
    expect.objectContaining({ bridge: h.windowBridge, onBeforeReload: h.stopTurn }),
  );
});
