// @vitest-environment jsdom
/**
 * perms-page.test.tsx — the Permissions page through its facade: the two switches, the monitor
 * list and when it loads, and the same page inside the composer.
 */

import { within } from "@testing-library/dom";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitorInfo } from "../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../logger";
import { createScreenshotSettings } from "../../../settings/capture/screenshot-settings";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs, renderPage } from "../test-helpers";
import { createPermsPage } from "./perms-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const newSettings = () =>
  createScreenshotSettings({ storage: { load: () => null, save: () => {} } });
// listMonitors is async; let its promise settle inside act before asserting.
const settle = () => act(async () => {});

const pages: { unmount(): void }[] = [];

function build({
  enabled = false,
  open = true,
  listMonitors = vi.fn(async (): Promise<MonitorInfo[]> => [{ index: 0, primary: true }]),
}: {
  enabled?: boolean;
  open?: boolean;
  listMonitors?: () => Promise<MonitorInfo[]>;
} = {}) {
  const settings = newSettings();
  if (enabled) settings.setEnabled(true);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const page = renderPage(
    createPermsPage({
      settings,
      sourceProvider: { listMonitors },
      log,
      isOpen: () => open,
    }),
  );
  pages.push(page);
  const view = within(page.el);
  return {
    page,
    settings,
    log,
    listMonitors,
    view,
    switchBtn: page.el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!,
    // The composer calls this on open.
    open: () => act(async () => page.loadMonitorsIfEnabled()),
  };
}

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.unmount();
  });
  document.body.innerHTML = "";
  setLocale("en");
  vi.restoreAllMocks();
});

describe("createPermsPage", () => {
  it("enabling the store while open checks the switch and lists the monitors once", async () => {
    const { settings, listMonitors, switchBtn } = build();

    await act(async () => settings.setEnabled(true));

    expect(switchBtn.getAttribute("aria-checked")).toBe("true");
    expect(listMonitors).toHaveBeenCalledTimes(1);
  });

  it("while closed a store change does not load, and a click still loads the list", async () => {
    const { settings, listMonitors, switchBtn } = build({ open: false });

    await act(async () => settings.setEnabled(true));
    expect(listMonitors).not.toHaveBeenCalled();

    await act(async () => settings.setEnabled(false));
    await act(async () => {
      fireEvent.click(switchBtn);
    });
    expect(settings.get().enabled).toBe(true);
    expect(listMonitors).toHaveBeenCalledTimes(1);
  });

  it("one attach click while open lists the monitors once", async () => {
    const { log, listMonitors, switchBtn } = build();

    await act(async () => {
      fireEvent.click(switchBtn);
    });

    expect(listMonitors).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("screenshot_attach_toggle", { enabled: true });
  });

  it("loadMonitorsIfEnabled() lists the monitors only when enabled", async () => {
    const off = build();
    off.page.loadMonitorsIfEnabled();
    await settle();
    expect(off.listMonitors).not.toHaveBeenCalled();

    const on = build({ enabled: true });
    on.page.loadMonitorsIfEnabled();
    await settle();
    expect(on.listMonitors).toHaveBeenCalledTimes(1);
  });

  it("after the page unmounts a store change does not load and the page's switch is gone", async () => {
    const { page, settings, listMonitors } = build();

    page.unmount();
    await act(async () => settings.setEnabled(true));

    expect(listMonitors).not.toHaveBeenCalled();
    expect(document.querySelector(".yui-screenshot-switch")).toBeNull();
  });
});

describe("screenshot request switch", () => {
  it.each([
    "en",
    "ja",
    "ko",
  ] as const)("mirrors the enabled row and reflects localized permission in %s", async (locale) => {
    setLocale(locale);
    const { page, settings, log, listMonitors, switchBtn } = build();
    const button = page.el.querySelector<HTMLButtonElement>(".yui-screenshot-requests-switch")!;
    expect(button.classList.contains("yui-switch")).toBe(true);
    expect(button.getAttribute("role")).toBe("switch");
    expect(button.getAttribute("type")).toBe("button");
    const row = button.closest(".yui-row")!;
    expect(row.className).toBe(switchBtn.closest(".yui-row")!.className);
    expect(row.querySelector(".yui-row__main .yui-row__label")?.textContent?.trim()).toBe(
      button.getAttribute("aria-label"),
    );
    expect(button.getAttribute("aria-label")).not.toMatch(/^screenshot\./);
    expect(button.getAttribute("aria-checked")).toBe("false");
    const footOff = row.querySelector(".yui-row__sub")!.textContent;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(settings.get().allowRequests).toBe(true);
    expect(settings.get().enabled).toBe(false);
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector(".yui-row__sub")!.textContent).not.toBe(footOff);
    expect(log.info).toHaveBeenCalledWith("screenshot_request_toggle", { allowed: true });
    expect(listMonitors).not.toHaveBeenCalled();
    await act(async () => settings.setAllowRequests(false));
    expect(button.getAttribute("aria-checked")).toBe("false");
  });
});

describe("monitor list", () => {
  const TWO = async (): Promise<MonitorInfo[]> => [
    { index: 0, primary: true, width: 1920, height: 1080 },
    { index: 1, width: 2560, height: 1440 },
  ];

  it("renders one radio per monitor with the current source checked, and follows the store", async () => {
    const { settings, view, open } = build({ enabled: true, listMonitors: TWO });
    await open();

    const radios = view.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("false");

    await act(async () => settings.setSource({ kind: "monitor", index: 1 }));
    expect(radios[0]!.getAttribute("aria-checked")).toBe("false");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the empty notice, and a successful empty result is not requested again", async () => {
    const listMonitors = vi.fn(async (): Promise<MonitorInfo[]> => []);
    const { page, view, open } = build({ enabled: true, listMonitors });
    await open();

    const notice = view.getByRole("status");
    expect(notice.className).toBe("yui-mon__empty");
    expect(notice.textContent).toBe("No displays found.");

    page.loadMonitorsIfEnabled();
    await settle();
    expect(listMonitors).toHaveBeenCalledTimes(1);
  });

  it("renders the error notice and asks again on the next trigger", async () => {
    const listMonitors = vi
      .fn<() => Promise<MonitorInfo[]>>()
      .mockRejectedValueOnce(new Error("enumeration failed"))
      .mockResolvedValue([{ index: 0, primary: true }]);
    const { page, view, log, open } = build({ enabled: true, listMonitors });
    await open();

    const notice = view.getByRole("status");
    expect(notice.className).toBe("yui-mon__error");
    expect(notice.textContent).toBe("Could not load the display list.");
    expect(log.error).toHaveBeenCalledWith("monitor_list_failed", {
      error: "Error: enumeration failed",
    });

    page.loadMonitorsIfEnabled();
    await settle();
    expect(listMonitors).toHaveBeenCalledTimes(2);
    expect(view.getAllByRole("radio")).toHaveLength(1);
    expect(view.queryByRole("status")).toBeNull();
  });
});

describe("createQuickControls — monitor picker error/empty state", () => {
  let mount: HTMLElement;

  // A timer tick, so the async listMonitors() promise settles before asserting.
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

  // Screenshot attach enabled so open() kicks off loadMonitors immediately.
  async function openQc(extra: Partial<Parameters<typeof createQuickControls>[0]>) {
    const settings = newSettings();
    settings.setEnabled(true);
    const qc = createQuickControls({ ...defaultQcArgs(mount), settings, ...extra });
    await act(async () => {
      qc.open();
      await flush();
    });
    return qc;
  }

  it("renders one .yui-mon radio per monitor on success, no error/empty row", async () => {
    const qc = await openQc({
      sourceProvider: {
        listMonitors: async () => [
          { index: 0, primary: true, width: 1920, height: 1080 },
          { index: 1, width: 2560, height: 1440 },
        ],
      },
    });

    const rows = qc.el.querySelectorAll<HTMLButtonElement>(".yui-mon[role=radio]");
    expect(rows).toHaveLength(2);
    expect(qc.el.querySelector(".yui-mon__error")).toBeNull();
    expect(qc.el.querySelector(".yui-mon__empty")).toBeNull();

    act(() => qc.dispose());
  });

  it("renders an inline error row when listMonitors() rejects", async () => {
    const qc = await openQc({
      sourceProvider: {
        listMonitors: async () => {
          throw new Error("enumeration failed");
        },
      },
    });

    const err = qc.el.querySelector<HTMLParagraphElement>(".yui-monitors .yui-mon__error");
    expect(err).not.toBeNull();
    expect(err!.getAttribute("role")).toBe("status");
    expect(err!.textContent).toBe("Could not load the display list.");
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(0);

    act(() => qc.dispose());
  });

  it("renders an explicit empty state when listMonitors() resolves to []", async () => {
    const qc = await openQc({ sourceProvider: { listMonitors: async () => [] } });

    const empty = qc.el.querySelector<HTMLParagraphElement>(".yui-monitors .yui-mon__empty");
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("role")).toBe("status");
    expect(empty!.textContent).toBe("No displays found.");
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(0);

    act(() => qc.dispose());
  });
});
