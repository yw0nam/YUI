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

import { createSettingsStores } from "./io/settings-stores";
import { setLocale } from "./ui/i18n";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
});

it("keeps the focused advanced input and its in-progress text across a locale rebuild", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

  document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!.click();
  const input = document.querySelector<HTMLInputElement>("#devtools-context-window")!;
  input.focus();
  input.value = "64000";
  input.dispatchEvent(new Event("input"));

  setLocale("ja");
  await vi.waitFor(() => {
    // The pre-rebuild input already satisfies activeElement === querySelector(...), so the
    // wait must also require a fresh node — otherwise it resolves before the rebuild runs.
    const current = document.querySelector("#devtools-context-window");
    expect(current).not.toBe(input);
    expect(document.activeElement).toBe(current);
  });

  const rebuilt = document.querySelector<HTMLInputElement>("#devtools-context-window")!;
  expect(rebuilt).not.toBe(input);
  expect(document.querySelector<HTMLElement>('[data-panel="advanced"]')!.hidden).toBe(false);
  expect(document.activeElement).toBe(rebuilt);
  expect(rebuilt.value).toBe("64000");

  // Blur resyncs from the store, so the restored text survives only if it committed.
  const stores = vi.mocked(createSettingsStores).mock.results[0]!.value;
  expect(stores.endpointsSettings.get().chat_model_context_window).toBe("64000");
  rebuilt.blur();
  expect(rebuilt.value).toBe("64000");
});
