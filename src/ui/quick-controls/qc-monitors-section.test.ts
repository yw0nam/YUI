// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenSource } from "../../contract";
import type { ScreenSourceProvider } from "../../io/screen-source-provider";
import type { createScreenshotSettings } from "../../io/screenshot-settings";
import type { Logger } from "../../logger";
import { setLocale } from "../i18n";
import { createMonitorsSection } from "./monitors-section";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

describe("createMonitorsSection", () => {
  let root: HTMLElement;
  let log: Logger;

  beforeEach(() => {
    root = document.createElement("div");
    root.innerHTML = '<div class="yui-monitors" role="radiogroup"></div>';
    document.body.appendChild(root);
    log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function makeSettings(initialSource: ScreenSource): ScreenshotSettingsStore {
    let source = initialSource;
    return {
      get: () => ({ enabled: true, source }),
      setEnabled: vi.fn(),
      setSource: vi.fn((next: ScreenSource) => {
        source = next;
      }),
      reloadFromStorage: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    };
  }

  function createSection(
    sourceProvider: ScreenSourceProvider,
    source: ScreenSource = { kind: "monitor", index: 0 },
  ) {
    return createMonitorsSection({
      root,
      sourceProvider,
      settings: makeSettings(source),
      log,
    });
  }

  it("renders one radio per monitor and marks the current source checked", async () => {
    const section = createSection(
      {
        listMonitors: async () => [
          { index: 0, primary: true, width: 1920, height: 1080 },
          { index: 1, width: 2560, height: 1440 },
        ],
      },
      { kind: "monitor", index: 1 },
    );

    await section.load();

    const radios = root.querySelectorAll<HTMLButtonElement>('.yui-mon[role="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute("aria-checked")).toBe("false");
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
  });

  it("renders the empty notice when no monitors are available", async () => {
    const section = createSection({ listMonitors: async () => [] });

    await section.load();

    const notice = root.querySelector<HTMLParagraphElement>(".yui-mon__empty");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toBe("No displays found.");
  });

  it("renders the error notice and remains unloaded when listing throws", async () => {
    const section = createSection({
      listMonitors: async () => {
        throw new Error("enumeration failed");
      },
    });

    await section.load();

    const notice = root.querySelector<HTMLParagraphElement>(".yui-mon__error");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toBe("Could not load the display list.");
    expect(section.isLoaded()).toBe(false);
    expect(log.error).toHaveBeenCalledWith("monitor_list_failed", {
      error: "Error: enumeration failed",
    });
  });

  it("marks the section loaded after a successful list", async () => {
    const section = createSection({ listMonitors: async () => [] });

    expect(section.isLoaded()).toBe(false);
    await section.load();
    expect(section.isLoaded()).toBe(true);
  });
});
