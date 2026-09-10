// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createDevtoolsShell, createConfigStore, initLogger, createLogger, log } =
  await vi.hoisted(async () => {
    const { makeDevtoolsMainMocks } = await import("./devtools-main.test-helpers");
    return {
      ...makeDevtoolsMainMocks(),
      createDevtoolsShell: vi.fn(() => ({
        active: "context" as const,
        activate: vi.fn(),
        dispose: vi.fn(),
      })),
    };
  });

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./ui/devtools/shell", () => ({ createDevtoolsShell }));
vi.mock("./config/store", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { resetDevtoolsMain } from "./devtools-main.test-helpers";
import { createSettingsStores } from "./io/settings-stores";

afterEach(() => {
  resetDevtoolsMain();
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
      endpointsSettings: bag.endpointsSettings,
    }),
  );
});
