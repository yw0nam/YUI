// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { createQuickControls, initLogger, createLogger } = vi.hoisted(() => ({
  createQuickControls: vi.fn(() => ({
    open: vi.fn(),
    dispose: vi.fn(),
    selectedTab: vi.fn(() => "general"),
  })),
  initLogger: vi.fn(async () => {}),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../ui/quick-controls/quick-controls", () => ({ createQuickControls }));
vi.mock("../logger", () => ({ initLogger, createLogger }));
// The real switch with its reload observed: jsdom cannot navigate.
const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("../app/settings/wire-preset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/settings/wire-preset")>();
  return {
    wirePresetSwitch: vi.fn<typeof actual.wirePresetSwitch>((deps) =>
      actual.wirePresetSwitch({ ...deps, reload }),
    ),
  };
});

// Each test boots a fresh settings-main; i18n is imported after the reset so a test drives the instance settings-main holds.
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(async () => {
  window.dispatchEvent(new Event("beforeunload"));
  (await import("../ui/i18n")).setLocale("en");
});

it("titles the settings window in the app language", async () => {
  const i18n = await import("../ui/i18n");
  i18n.setLocale("ko");

  await import("./settings-main");

  await vi.waitFor(() => expect(createQuickControls).toHaveBeenCalledOnce());
  expect(document.title).toBe("YUI 설정");

  i18n.setLocale("ja");
  await vi.waitFor(() => expect(document.title).toBe("YUI 設定"));
}, 15_000);

it("reopens the remounted panel on the tab the user was on when the language changes", async () => {
  await import("./settings-main");
  await vi.waitFor(() => expect(createQuickControls).toHaveBeenCalledOnce());

  const i18n = await import("../ui/i18n");
  i18n.setLocale("ko");
  await vi.waitFor(() => expect(createQuickControls).toHaveBeenCalledTimes(2));
  const remounted = createQuickControls.mock.results[1]!.value;
  expect(remounted.open).toHaveBeenCalledWith(undefined, { tab: "general" });
}, 15_000);

it("reloads when the pet window's preset switch arrives over the settings bridge", async () => {
  const list = [
    { id: "default", name: "default" },
    { id: "aaaa0001", name: "natsume" },
  ];
  localStorage.setItem("yui.presets", JSON.stringify({ active: "default", list }));
  await import("./settings-main");
  await vi.waitFor(() => expect(createQuickControls).toHaveBeenCalledOnce());
  const { createSettingsBridge } = await import("../io/bridge/settings-bridge");
  const pet = createSettingsBridge(undefined, { windowKind: "pet" });

  localStorage.setItem("yui.presets", JSON.stringify({ active: "aaaa0001", list }));
  await pet.emitPresetChanged({ active: "aaaa0001" });

  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  pet.dispose();
  localStorage.removeItem("yui.presets");
}, 15_000);
