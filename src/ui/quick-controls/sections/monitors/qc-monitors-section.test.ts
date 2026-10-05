// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenSource } from "../../../../contract";
import type { ScreenSourceProvider } from "../../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../../logger";
import type { createScreenshotSettings } from "../../../../settings/capture/screenshot-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";
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

describe("createQuickControls — monitor picker error/empty state", () => {
  let mount: HTMLElement;

  // microtask flush — listMonitors is async; let its promise settle before asserting.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // Screenshot attach enabled so open() kicks off loadMonitors immediately.
  function makeEnabledSettings() {
    return {
      get: () => ({ enabled: true, source: { kind: "monitor" as const, index: 0 } }),
      setEnabled: vi.fn(),
      setSource: vi.fn(),
      reloadFromStorage: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    };
  }

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      settings: makeEnabledSettings(),
      ...extra,
    });
  }

  it("renders one .yui-mon radio per monitor on success, no error/empty row", async () => {
    const qc = buildQc({
      sourceProvider: {
        listMonitors: async () => [
          { index: 0, primary: true, width: 1920, height: 1080 },
          { index: 1, width: 2560, height: 1440 },
        ],
      },
    });
    qc.open();
    await flush();

    const rows = qc.el.querySelectorAll<HTMLButtonElement>(".yui-mon[role=radio]");
    expect(rows).toHaveLength(2);
    expect(qc.el.querySelector(".yui-mon__error")).toBeNull();
    expect(qc.el.querySelector(".yui-mon__empty")).toBeNull();

    qc.dispose();
  });

  it("renders an inline error row when listMonitors() rejects", async () => {
    const qc = buildQc({
      sourceProvider: {
        listMonitors: async () => {
          throw new Error("enumeration failed");
        },
      },
    });
    qc.open();
    await flush();

    const err = qc.el.querySelector<HTMLParagraphElement>(".yui-monitors .yui-mon__error");
    expect(err).not.toBeNull();
    expect(err!.getAttribute("role")).toBe("status");
    expect(err!.textContent).toBe("Could not load the display list.");
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(0);

    qc.dispose();
  });

  it("renders an explicit empty state when listMonitors() resolves to []", async () => {
    const qc = buildQc({
      sourceProvider: { listMonitors: async () => [] },
    });
    qc.open();
    await flush();

    const empty = qc.el.querySelector<HTMLParagraphElement>(".yui-monitors .yui-mon__empty");
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("role")).toBe("status");
    expect(empty!.textContent).toBe("No displays found.");
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(0);

    qc.dispose();
  });

  it("retries loading on the next open after a failure", async () => {
    let fail = true;
    const qc = buildQc({
      sourceProvider: {
        listMonitors: async () => {
          if (fail) throw new Error("enumeration failed");
          return [{ index: 0, primary: true }];
        },
      },
    });
    qc.open();
    await flush();
    expect(qc.el.querySelector(".yui-mon__error")).not.toBeNull();

    fail = false;
    qc.close();
    qc.open();
    await flush();

    expect(qc.el.querySelector(".yui-mon__error")).toBeNull();
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(1);

    qc.dispose();
  });
});
