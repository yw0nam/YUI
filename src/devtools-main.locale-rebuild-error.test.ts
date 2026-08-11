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

const { createDevtoolsShell, shellState } = vi.hoisted(() => {
  const shellState = { builds: 0, previewLoads: 0 };
  const createDevtoolsShell = vi.fn(({ mount }: { mount: HTMLElement }) => {
    shellState.builds++;
    const build = shellState.builds;
    let active: "context" | "motion" = "context";
    const motionButton = document.createElement("button");
    motionButton.dataset.section = "motion";
    mount.replaceChildren(motionButton);

    const activate = vi.fn(async (section: "context" | "advanced" | "motion") => {
      active = section === "motion" ? "motion" : "context";
      if (section !== "motion") return;
      shellState.previewLoads++;
      if (build === 2) throw new Error("preview load failed");
      mount.innerHTML = '<select id="sel-crossfade"></select>';
    });
    motionButton.addEventListener("click", () => void activate("motion"));

    return {
      get active() {
        return active;
      },
      activate,
      dispose: vi.fn(() => mount.replaceChildren()),
    };
  });
  return { createDevtoolsShell, shellState };
});

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./config", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./ui/devtools/shell", () => ({ createDevtoolsShell }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { setLocale } from "./ui/i18n";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
});

it("continues locale rebuilds after a motion preview load rejects", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(shellState.builds).toBe(1));

  document.querySelector<HTMLButtonElement>('[data-section="motion"]')!.click();
  await vi.waitFor(() => expect(document.querySelector("#sel-crossfade")).not.toBeNull());

  setLocale("ja");
  await vi.waitFor(() => expect(shellState.previewLoads).toBe(2));

  setLocale("ko");
  await vi.waitFor(() => expect(shellState.builds).toBe(3));
  await vi.waitFor(() => expect(document.querySelector("#sel-crossfade")).not.toBeNull());
  expect(log.error).toHaveBeenCalledWith("locale_rebuild_failed", {
    error: "Error: preview load failed",
  });
});
