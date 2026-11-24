// @vitest-environment jsdom

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger, log, presetRemote } =
  vi.hoisted(() => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // What the pet window's preset-changed message reaches through the window's settings bridge.
    const presetRemote: { send: (change: { active: string }) => void } = { send: () => {} };
    return {
      wireDevtoolsSync: vi.fn(() => ({
        reload: vi.fn(),
        dispose: vi.fn(),
        bridge: {
          emitPresetChanged: async () => {},
          onPresetChanged: (cb: (change: { active: string }) => void) => {
            presetRemote.send = cb;
            return () => {};
          },
        },
      })),
      presetRemote,
      createConfigStore: vi.fn(() => ({
        load: vi.fn(async () => ({ endpoints: { chat_model_context_window: 1 } })),
      })),
      initLogger: vi.fn(async () => undefined),
      createLogger: vi.fn(() => log),
      log,
    };
  });

vi.mock("../app/cross-window/wire-cross-window", () => ({ wireDevtoolsSync }));
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
vi.mock("../config/store", () => ({ createConfigStore }));
vi.mock("../logger", () => ({ initLogger, createLogger }));
const { mountMotionPreview } = vi.hoisted(() => {
  const clip = { kind: "ambient", loop: true, priority: 10, interrupt_policy: "replace" } as const;
  return {
    mountMotionPreview: vi.fn<
      typeof import("../ui/devtools/motion-preview/motion-preview").mountMotionPreview
    >(async (view) => {
      view.ready({
        renderer: {} as never,
        registry: {
          idle: { ...clip, vrma_path: "/motions/idle.vrma" },
          wave: { ...clip, vrma_path: "/motions/wave.vrma" },
        },
        variantIds: new Set(),
        emotions: {} as never,
      });
      return { dispose: vi.fn() };
    }),
  };
});

vi.mock("../ui/devtools/motion-preview/motion-preview", () => ({ mountMotionPreview }));
vi.mock("../ui/devtools/shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/devtools/shell")>();
  return { ...actual, createDevtoolsShell: vi.fn(actual.createDevtoolsShell) };
});
// The shell mock outlives resetModules, so every fresh boot shares the i18n instance it reads.
vi.mock("../ui/i18n", async (importOriginal) => importOriginal<typeof import("../ui/i18n")>());
vi.mock("../settings/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});
vi.mock("../app/settings/conversation-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/settings/conversation-stores")>();
  return { ...actual, createConversationStores: vi.fn(actual.createConversationStores) };
});

type CorsFetchGlobal = { CORSFetch?: { config: (c: { exclude: RegExp[] }) => void } };

afterEach(async () => {
  window.dispatchEvent(new Event("beforeunload"));
  const { setLocale } = await import("../ui/i18n");
  setLocale("en");
  vi.clearAllMocks();
  delete (globalThis as CorsFetchGlobal).CORSFetch;
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

it("reloads when the pet window's preset switch arrives over the settings bridge", async () => {
  const list = [
    { id: "default", name: "default" },
    { id: "aaaa0001", name: "natsume" },
  ];
  localStorage.setItem("yui.presets", JSON.stringify({ active: "default", list }));
  await bootFresh();

  localStorage.setItem("yui.presets", JSON.stringify({ active: "aaaa0001", list }));
  presetRemote.send({ active: "aaaa0001" });

  expect(reload).toHaveBeenCalledOnce();
  localStorage.removeItem("yui.presets");
});

it("passes both store bags and their devtools stores through bootstrap by identity", async () => {
  await bootFresh();
  await vi.waitFor(() => expect(wireDevtoolsSync).toHaveBeenCalledOnce());

  const { createSettingsStores } = await import("../settings/settings-stores");
  const { createConversationStores } = await import("../app/settings/conversation-stores");
  const { createDevtoolsShell } = await import("../ui/devtools/shell");
  const bag = vi.mocked(createSettingsStores).mock.results.at(-1)!.value;
  const conversation = vi.mocked(createConversationStores).mock.results.at(-1)!.value;
  expect(wireDevtoolsSync).toHaveBeenCalledWith({ stores: bag, conversation, log });
  expect(createDevtoolsShell).toHaveBeenCalledWith(
    expect.objectContaining({
      history: conversation.contextHistory,
      endpointsSettings: bag.endpointsSettings,
    }),
  );
});

/** Switches the locale and waits for the translated header. */
async function toJapanese(setLocale: (l: "ja") => void) {
  await act(async () => setLocale("ja"));
  await vi.waitFor(() =>
    expect(document.querySelector(".devtools-header")?.textContent).toBe("開発者ツール"),
  );
}

it("keeps the focused advanced input and its in-progress text across a locale change", async () => {
  const setLocale = await bootFresh();
  const { createSettingsStores } = await import("../settings/settings-stores");

  act(() => fireEvent.click(screen.getByText("Advanced Settings")));
  const input = screen.getByLabelText<HTMLInputElement>("Context window (tokens)");
  act(() => input.focus());
  fireEvent.input(input, { target: { value: "64000" } });

  await toJapanese(setLocale);

  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("64000");
  act(() => input.blur());
  const stores = vi.mocked(createSettingsStores).mock.results.at(-1)!.value;
  expect(stores.endpointsSettings.get().chat_model_context_window).toBe("64000");
});

it("keeps focus on the active nav button across a locale change", async () => {
  const setLocale = await bootFresh();

  const advanced = screen.getByText("Advanced Settings");
  act(() => advanced.focus());

  await toJapanese(setLocale);

  expect(document.activeElement).toBe(advanced);
});

it("keeps the focused motion crossfade select, its selection and its one motion load across a locale change", async () => {
  const setLocale = await bootFresh();

  act(() => fireEvent.click(screen.getByText("Motion Preview")));
  await vi.waitFor(() =>
    expect(screen.queryByRole("combobox", { name: "crossfade" })).not.toBeNull(),
  );
  const select = screen.getByRole("combobox", { name: "crossfade" });
  await act(async () => fireEvent.click(select));
  const wave = [...document.querySelectorAll('[role="option"]')].find(
    (o) => o.textContent === "wave" && !o.closest("[hidden]"),
  )!;
  await act(async () => {
    fireEvent.pointerDown(wave);
    fireEvent.click(wave);
  });
  act(() => select.focus());

  await toJapanese(setLocale);

  expect(document.activeElement).toBe(select);
  expect(select.textContent).toBe("wave");
  expect(mountMotionPreview).toHaveBeenCalledOnce();
});

it("keeps its own origin off the cors-fetch proxy", async () => {
  const config = vi.fn();
  (globalThis as CorsFetchGlobal).CORSFetch = { config };
  await bootFresh();

  await vi.waitFor(() => expect(config).toHaveBeenCalledOnce());
  const { exclude } = config.mock.calls[0][0];
  expect(exclude).toHaveLength(1);
  expect(exclude[0].test(`${location.origin}/x`)).toBe(true);
});
