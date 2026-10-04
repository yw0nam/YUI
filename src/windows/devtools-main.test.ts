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
const { mountMotionPreview, motionPreviewState } = vi.hoisted(() => {
  const motionPreviewState = {
    calls: 0,
    disposes: 0,
    blockSecondLoad: false,
    releaseSecondLoad: () => {},
  };
  const mountMotionPreview = vi.fn(async (mount: HTMLElement) => {
    motionPreviewState.calls++;
    if (motionPreviewState.blockSecondLoad && motionPreviewState.calls === 2) {
      await new Promise<void>((resolve) => {
        motionPreviewState.releaseSecondLoad = resolve;
      });
    }
    mount.innerHTML =
      '<select id="sel-crossfade"><option value="idle">idle</option><option value="wave">wave</option></select>';
    return {
      dispose: vi.fn(() => {
        motionPreviewState.disposes++;
      }),
    };
  });
  return { mountMotionPreview, motionPreviewState };
});

vi.mock("../ui/devtools/motion-preview", () => ({ mountMotionPreview }));
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

// jsdom lacks CSS.escape, which the nav focus restore needs.
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: mirror the real escape's control-char handling.
      String(value).replace(/[\x00-\x7f]/g, (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`)),
  };
}

afterEach(async () => {
  window.dispatchEvent(new Event("beforeunload"));
  // The shell disposes a mounted preview asynchronously; let it land before the counters reset.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  setLocale("en");
  mountMotionPreview.mockClear();
  motionPreviewState.calls = 0;
  motionPreviewState.disposes = 0;
  motionPreviewState.blockSecondLoad = false;
  motionPreviewState.releaseSecondLoad = () => {};
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

/** Boots a fresh entry module; the locale setter must come from the same module graph. */
async function bootFresh() {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("./devtools-main");
  const { setLocale } = await import("../ui/i18n");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());
  return setLocale;
}

it("keeps the focused advanced input and its in-progress text across a locale rebuild", async () => {
  const setLocale = await bootFresh();
  const { createSettingsStores } = await import("../settings/settings-stores");

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
  expect(rebuilt).not.toBe(input);
  expect(document.querySelector<HTMLElement>('[data-panel="advanced"]')!.hidden).toBe(false);
  expect(document.activeElement).toBe(rebuilt);
  expect(rebuilt.value).toBe("64000");

  // Blur resyncs from the store, so the restored text survives only if it committed.
  const stores = vi.mocked(createSettingsStores).mock.results.at(-1)!.value;
  expect(stores.endpointsSettings.get().chat_model_context_window).toBe("64000");
  rebuilt.blur();
  expect(rebuilt.value).toBe("64000");
});

it("keeps focus on the active nav button across a locale rebuild", async () => {
  const setLocale = await bootFresh();

  const advanced = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  advanced.focus();

  setLocale("ja");
  await vi.waitFor(() => {
    // The pre-rebuild button already satisfies activeElement === querySelector(...), so the
    // wait must also require a fresh node, otherwise it resolves before the rebuild runs.
    const current = document.querySelector('[data-section="advanced"]');
    expect(current).not.toBe(advanced);
    expect(document.activeElement).toBe(current);
  });

  const rebuilt = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  expect(rebuilt).not.toBe(advanced);
  expect(document.activeElement).toBe(rebuilt);
});

it("keeps the focused motion clip-picker select and its selection across a locale rebuild", async () => {
  const setLocale = await bootFresh();

  document.querySelector<HTMLButtonElement>('[data-section="motion"]')!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLSelectElement>("#sel-crossfade")).not.toBeNull(),
  );
  const select = document.querySelector<HTMLSelectElement>("#sel-crossfade")!;
  select.focus();
  select.value = "wave";

  setLocale("ja");
  await vi.waitFor(() => expect(mountMotionPreview).toHaveBeenCalledTimes(2));

  const rebuilt = document.querySelector<HTMLSelectElement>("#sel-crossfade")!;
  expect(rebuilt).not.toBe(select);
  expect(document.activeElement).toBe(rebuilt);
  expect(rebuilt.value).toBe("wave");
});

it("serializes rapid locale rebuilds until the final motion preview mounts", async () => {
  motionPreviewState.blockSecondLoad = true;
  const setLocale = await bootFresh();

  document.querySelector<HTMLButtonElement>('[data-section="motion"]')!.click();
  await vi.waitFor(() => expect(document.querySelector("#sel-crossfade")).not.toBeNull());

  setLocale("ja");
  await vi.waitFor(() => expect(motionPreviewState.calls).toBe(2));
  expect(document.querySelector(".devtools-loading")).not.toBeNull();

  setLocale("ko");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(motionPreviewState.calls).toBe(2);

  motionPreviewState.releaseSecondLoad();
  await vi.waitFor(() => expect(motionPreviewState.calls).toBe(3));
  await vi.waitFor(() => expect(document.querySelector("#sel-crossfade")).not.toBeNull());
  expect(document.querySelector(".devtools-loading")).toBeNull();
  expect(motionPreviewState.calls - motionPreviewState.disposes).toBe(1);
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
