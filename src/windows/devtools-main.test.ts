// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger, log } = vi.hoisted(() => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    wireDevtoolsSync: vi.fn(() => ({ reload: vi.fn(), dispose: vi.fn() })),
    createConfigStore: vi.fn(() => ({
      load: vi.fn().mockResolvedValue({ endpoints: { chat_model_context_window: 1 } }),
    })),
    initLogger: vi.fn().mockResolvedValue(undefined),
    createLogger: vi.fn(() => log),
    log,
  };
});

vi.mock("../app/cross-window/wire-cross-window", () => ({ wireDevtoolsSync }));
vi.mock("../config/store", () => ({ createConfigStore }));
vi.mock("../logger", () => ({ initLogger, createLogger }));
vi.mock("../ui/devtools/shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/devtools/shell")>();
  return { ...actual, createDevtoolsShell: vi.fn(actual.createDevtoolsShell) };
});
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
import { createDevtoolsShell } from "../ui/devtools/shell";
import { setLocale } from "../ui/i18n";

type CorsFetchGlobal = { CORSFetch?: { config: (c: { exclude: RegExp[] }) => void } };

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
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

it("rebuilds the real shell on a locale change and commits the focused advanced input", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  vi.resetModules();
  await import("./devtools-main");
  const { createSettingsStores } = await import("../settings/settings-stores");
  const { setLocale } = await import("../ui/i18n");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

  document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!.click();
  const input = document.querySelector<HTMLInputElement>("#devtools-context-window")!;
  input.focus();
  input.value = "64000";
  input.dispatchEvent(new Event("input"));

  setLocale("ja");
  await vi.waitFor(() => {
    // The pre-rebuild input already satisfies activeElement === querySelector(...), so the
    // wait must also require a fresh node, otherwise it resolves before the rebuild runs.
    const current = document.querySelector("#devtools-context-window");
    expect(current).not.toBe(input);
    expect(document.activeElement).toBe(current);
  });

  const rebuilt = document.querySelector<HTMLInputElement>("#devtools-context-window")!;
  expect(document.querySelector<HTMLElement>('[data-panel="advanced"]')!.hidden).toBe(false);
  expect(rebuilt.value).toBe("64000");

  // Blur resyncs from the store, so the restored text survives only if it committed.
  const stores = vi.mocked(createSettingsStores).mock.results.at(-1)!.value;
  expect(stores.endpointsSettings.get().chat_model_context_window).toBe("64000");
  rebuilt.blur();
  expect(rebuilt.value).toBe("64000");
});
