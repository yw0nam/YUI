// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger } = vi.hoisted(() => ({
  wireDevtoolsSync: vi.fn(() => ({ reload: vi.fn(), dispose: vi.fn() })),
  createConfigStore: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({ endpoints: { chat_model_context_window: 1 } }),
  })),
  initLogger: vi.fn().mockResolvedValue(undefined),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./config", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { setLocale } from "./ui/i18n";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
});

it("keeps focus on the active nav button across a locale rebuild", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

  const advanced = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  advanced.focus();

  setLocale("ja");
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  const rebuilt = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  expect(rebuilt).not.toBe(advanced);
  expect(document.activeElement).toBe(rebuilt);
});
