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
