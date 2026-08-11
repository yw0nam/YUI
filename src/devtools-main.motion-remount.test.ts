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
    mount.innerHTML = '<select id="sel-crossfade"></select>';
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
  motionPreviewState.blockSecondLoad = false;
  motionPreviewState.releaseSecondLoad = () => {};
});

it("serializes rapid locale rebuilds until the final motion preview mounts", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  motionPreviewState.blockSecondLoad = true;

  await import("./devtools-main");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

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
});
