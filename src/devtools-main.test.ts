// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createDevtoolsShell, createConfigStore, initLogger, createLogger, log } =
  vi.hoisted(() => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    return {
      wireDevtoolsSync: vi.fn(() => ({ reload: vi.fn(), dispose: vi.fn() })),
      createDevtoolsShell: vi.fn(() => ({ activate: vi.fn(), dispose: vi.fn() })),
      createConfigStore: vi.fn(() => ({
        load: vi.fn().mockResolvedValue({ endpoints: { chat_model_context_window: 1 } }),
      })),
      initLogger: vi.fn().mockResolvedValue(undefined),
      createLogger: vi.fn(() => log),
      log,
    };
  });

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./ui/devtools/shell", () => ({ createDevtoolsShell }));
vi.mock("./config", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { createSettingsStores } from "./io/settings-stores";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
});

it("passes the registry bag and its devtools stores through bootstrap by identity", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(wireDevtoolsSync).toHaveBeenCalledOnce());

  const bag = vi.mocked(createSettingsStores).mock.results[0]!.value;
  expect(wireDevtoolsSync).toHaveBeenCalledWith({ stores: bag, log });
  expect(createDevtoolsShell).toHaveBeenCalledWith(
    expect.objectContaining({
      history: bag.contextHistory,
      contextSettings: bag.contextSettings,
      recentAppsSettings: bag.recentAppsSettings,
      endpointsSettings: bag.endpointsSettings,
    }),
  );
});
