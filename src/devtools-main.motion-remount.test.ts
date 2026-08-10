// @vitest-environment jsdom
//
// Pins the motion-section remount behavior across a locale-driven rebuild: restoring
// focus to the motion section re-invokes loadMotionPreview, and each rebuild must
// dispose the previous instance rather than leaving two live at once.

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger } = vi.hoisted(() => ({
  wireDevtoolsSync: vi.fn(() => ({ reload: vi.fn(), dispose: vi.fn() })),
  createConfigStore: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({ endpoints: { chat_model_context_window: 1 } }),
  })),
  initLogger: vi.fn().mockResolvedValue(undefined),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const { mountMotionPreview, motionPreviewState } = vi.hoisted(() => {
  const motionPreviewState = { calls: 0, disposes: 0 };
  const mountMotionPreview = vi.fn(async (mount: HTMLElement) => {
    motionPreviewState.calls++;
    mount.innerHTML = "<select id=\"sel-crossfade\"></select>";
    return {
      dispose: vi.fn(() => {
        motionPreviewState.disposes++;
      }),
    };
  });
  return { mountMotionPreview, motionPreviewState };
});

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./config", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./ui/devtools/motion-preview", () => ({ mountMotionPreview }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { setLocale } from "./ui/i18n";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
  mountMotionPreview.mockClear();
  motionPreviewState.calls = 0;
  motionPreviewState.disposes = 0;
});

it("disposes the previous motion-preview instance for every locale rebuild, never leaving two live", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

  document.querySelector<HTMLButtonElement>('[data-section="motion"]')!.click();
  await vi.waitFor(() => expect(motionPreviewState.calls).toBe(1));

  setLocale("ja");
  await vi.waitFor(() => expect(motionPreviewState.calls).toBe(2));
  await vi.waitFor(() => expect(motionPreviewState.disposes).toBe(1));

  setLocale("ko");
  await vi.waitFor(() => expect(motionPreviewState.calls).toBe(3));
  await vi.waitFor(() => expect(motionPreviewState.disposes).toBe(2));

  // One mount always stays live (undisposed) per rebuild — never two, never zero.
  expect(motionPreviewState.calls - motionPreviewState.disposes).toBe(1);
});
