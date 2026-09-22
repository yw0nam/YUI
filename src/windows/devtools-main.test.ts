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

vi.mock("../app/cross-window/wire-cross-window", () => ({ wireDevtoolsSync }));
vi.mock("../ui/devtools/shell", () => ({ createDevtoolsShell }));
vi.mock("../config/store", () => ({ createConfigStore }));
vi.mock("../logger", () => ({ initLogger, createLogger }));
vi.mock("../settings/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});
vi.mock("../app/settings/conversation-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/settings/conversation-stores")>();
  return { ...actual, createConversationStores: vi.fn(actual.createConversationStores) };
});

import { createConversationStores } from "../app/settings/conversation-stores";
import { createSettingsStores } from "../settings/settings-stores";
import { resetDevtoolsMain } from "./devtools-main.test-helpers";

type CorsFetchGlobal = { CORSFetch?: { config: (c: { exclude: RegExp[] }) => void } };

afterEach(() => {
  resetDevtoolsMain();
  delete (globalThis as CorsFetchGlobal).CORSFetch;
});

it("passes both store bags and their devtools stores through bootstrap by identity", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(wireDevtoolsSync).toHaveBeenCalledOnce());

  const bag = vi.mocked(createSettingsStores).mock.results[0]!.value;
  const conversation = vi.mocked(createConversationStores).mock.results[0]!.value;
  expect(wireDevtoolsSync).toHaveBeenCalledWith({ stores: bag, conversation, log });
  expect(createDevtoolsShell).toHaveBeenCalledWith(
    expect.objectContaining({
      history: conversation.contextHistory,
      endpointsSettings: bag.endpointsSettings,
    }),
  );
});

it("keeps its own origin off the cors-fetch proxy", async () => {
  const config = vi.fn();
  (globalThis as CorsFetchGlobal).CORSFetch = { config };
  document.body.innerHTML = '<div id="app"></div>';

  vi.resetModules();
  await import("./devtools-main");

  await vi.waitFor(() => expect(config).toHaveBeenCalledOnce());
  const { exclude } = config.mock.calls[0][0];
  expect(exclude).toHaveLength(1);
  expect(exclude[0].test(`${location.origin}/x`)).toBe(true);
});
