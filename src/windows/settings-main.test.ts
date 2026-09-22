// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { createQuickControls, initLogger, createLogger } = vi.hoisted(() => ({
  createQuickControls: vi.fn(() => ({ open: vi.fn(), dispose: vi.fn() })),
  initLogger: vi.fn(async () => {}),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../ui/quick-controls/quick-controls", () => ({ createQuickControls }));
vi.mock("../logger", () => ({ initLogger, createLogger }));

import { setLocale } from "../ui/i18n";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
});

it("titles the settings window in the app language", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  setLocale("ko");

  await import("./settings-main");

  await vi.waitFor(() => expect(createQuickControls).toHaveBeenCalledOnce());
  expect(document.title).toBe("YUI 설정");

  setLocale("ja");
  await vi.waitFor(() => expect(document.title).toBe("YUI 設定"));
});
