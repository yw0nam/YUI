// @vitest-environment jsdom
/**
 * plugins-page.test.tsx — the Plugins page over the MCP host's snapshot, catalog and commands.
 */

import { createEvent, within } from "@testing-library/dom";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogEntry,
  PluginHostPlugin,
  PluginHostServer,
  PluginHostSnapshot,
} from "../../../io/mcp-host/mcp-host";
import { setLocale } from "../../i18n";
import { fakePlugins } from "../test-helpers";
import { createPluginsPage, type PluginsPage } from "./plugins-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const server = (
  pluginId: string,
  name: string,
  over: Partial<PluginHostServer> = {},
): PluginHostServer => ({
  id: `${pluginId}/${name}`,
  name,
  status: "running",
  phase: null,
  reason: null,
  command: `/plugins/${pluginId}/bin/${name} --stdio`,
  ...over,
});

const plugin = (over: Partial<PluginHostPlugin> & { id: string }): PluginHostPlugin => ({
  version: "0.1.0",
  description: null,
  source: "official",
  path: `/plugins/${over.id}`,
  enabled: true,
  consented: true,
  error: null,
  servers: [],
  tools: [],
  skills: [],
  hidden: [],
  ...over,
});

const SNAPSHOT: PluginHostSnapshot = {
  revision: 1,
  plugins: [
    plugin({
      id: "browser",
      servers: [server("browser", "browser")],
      hidden: [{ kind: "tool", name: "browser", holder: "builtin" }],
    }),
    plugin({ id: "yui-test", source: "local", servers: [server("yui-test", "main")] }),
    plugin({
      id: "weather",
      version: "0.4.1",
      source: "community",
      consented: false,
      servers: [server("weather", "weather", { status: "stopped" })],
    }),
  ],
};

const CATALOG: CatalogEntry[] = [
  { id: "weather", source: "community", version: "0.5.0", summary: "Weather.", error: null },
  { id: "calendar-ics", source: "community", version: "0.2.3", summary: "Events.", error: null },
];

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const pages: PluginsPage[] = [];

function mountPage(snapshot: PluginHostSnapshot | null = SNAPSHOT) {
  const fake = fakePlugins(snapshot);
  fake.manage.catalog.mockResolvedValue(CATALOG);
  const page = createPluginsPage({ host: fake.host, manage: fake.manage, log });
  pages.push(page);
  document.body.append(page.el);
  return { ...fake, page };
}

/** Enters the page and lets the catalog load settle. */
async function enter(page: PluginsPage): Promise<void> {
  await act(async () => {
    page.entered();
  });
}

const group = (el: HTMLElement, id: string): HTMLElement =>
  el.querySelector<HTMLElement>(`[data-pid="${id}"]`)!;

describe("createPluginsPage", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    act(() => {
      for (const page of pages.splice(0)) page.dispose();
    });
    document.body.innerHTML = "";
  });

  it("lists the installed plugins and the catalog entries not installed", async () => {
    const { page, manage } = mountPage();
    await enter(page);

    expect(
      Array.from(page.el.querySelectorAll<HTMLElement>("[data-pid]"), (g) => g.dataset.pid),
    ).toEqual(["browser", "yui-test", "weather"]);
    expect(group(page.el, "browser").querySelector(".yui-plg-hid")?.textContent).toBe(
      "Hidden tool browser: a built-in tool uses this name",
    );
    const weather = group(page.el, "weather");
    const weatherScope = within(weather);
    act(() => {
      fireEvent.click(weatherScope.getByRole("button", { name: "Allow again…" }));
    });
    expect(weather.querySelector(".yui-plg-consent__q")?.textContent).toBe(
      "The update changed its contents. Run it again?",
    );
    expect(weather.querySelector(".yui-plg-sv")).toBeNull();
    act(() => {
      fireEvent.click(weatherScope.getByRole("button", { name: "Update to v0.5.0" }));
    });
    expect(manage.install).toHaveBeenCalledWith("weather");
    expect(within(page.el).getByRole("button", { name: "Install calendar-ics" })).toBeTruthy();
    expect(within(page.el).queryByRole("button", { name: "Install weather" })).toBeNull();
  });

  it("asks consent with the launch command, then lists the declared tools once started", async () => {
    const fresh = plugin({
      id: "calendar-ics",
      enabled: false,
      consented: false,
      servers: [server("calendar-ics", "calendar-ics", { status: "stopped" })],
    });
    const { page, manage, emit } = mountPage({ revision: 1, plugins: [fresh] });
    manage.enable.mockImplementation(async () => {
      emit({
        revision: 2,
        plugins: [
          {
            ...fresh,
            enabled: true,
            consented: true,
            servers: [server("calendar-ics", "calendar-ics")],
            tools: [
              {
                name: "calendar_today",
                server: "calendar-ics/calendar-ics",
                description: "Today's events.",
                inputSchema: {},
                meta: null,
              },
            ],
          },
        ],
      });
    });

    act(() => {
      fireEvent.click(
        within(group(page.el, "calendar-ics")).getByRole("switch", {
          name: "Turn on calendar-ics",
        }),
      );
    });
    const consent = group(page.el, "calendar-ics").querySelector<HTMLElement>(".yui-plg-consent")!;
    expect(consent.querySelector(".yui-plg-cmd")?.textContent).toBe(
      "/plugins/calendar-ics/bin/calendar-ics --stdio",
    );

    await act(async () => {
      fireEvent.click(within(consent).getByRole("button", { name: "Allow" }));
    });
    expect(manage.enable).toHaveBeenCalledWith("calendar-ics");
    expect(
      Array.from(
        group(page.el, "calendar-ics").querySelectorAll(".yui-plg-consent .yui-plg-tools__name"),
        (n) => n.textContent,
      ),
    ).toEqual(["calendar_today"]);
  });

  it("keeps the switch off while a plugin's step-1 consent is open", () => {
    const fresh = plugin({
      id: "calendar-ics",
      enabled: false,
      consented: false,
      servers: [server("calendar-ics", "calendar-ics", { status: "stopped" })],
    });
    const { page } = mountPage({ revision: 1, plugins: [fresh] });
    const toggle = () =>
      within(group(page.el, "calendar-ics")).getByRole("switch", { name: "Turn on calendar-ics" });
    const panel = () => group(page.el, "calendar-ics").querySelector(".yui-plg-consent");

    act(() => {
      fireEvent.click(toggle());
    });
    expect(panel()).not.toBeNull();
    expect(toggle().getAttribute("aria-checked")).toBe("false");

    act(() => {
      fireEvent.click(toggle());
    });
    expect(panel()).toBeNull();
  });

  it("shows the failed panel when a server fails after enable has resolved", async () => {
    const fresh = plugin({
      id: "calendar-ics",
      enabled: false,
      consented: false,
      servers: [server("calendar-ics", "calendar-ics", { status: "stopped" })],
    });
    const { page, manage, emit } = mountPage({ revision: 1, plugins: [fresh] });
    const started = (status: PluginHostServer["status"], revision: number) => ({
      revision,
      plugins: [
        {
          ...fresh,
          enabled: true,
          consented: true,
          servers: [server("calendar-ics", "calendar-ics", { status })],
        },
      ],
    });
    manage.enable.mockImplementation(async () => emit(started("starting", 2)));
    const question = () =>
      group(page.el, "calendar-ics").querySelector(".yui-plg-consent__q")?.textContent;

    act(() => {
      fireEvent.click(
        within(group(page.el, "calendar-ics")).getByRole("switch", {
          name: "Turn on calendar-ics",
        }),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(group(page.el, "calendar-ics")).getByRole("button", { name: "Allow" }),
      );
    });
    // enable has resolved and the page has settled while the snapshot still says starting.
    act(() => emit(started("failed", 3)));

    expect(question()).toBe("Some servers could not start.");
  });

  it("shows an install rejection as the host sent it, with a Retry that installs again", async () => {
    const { page, manage } = mountPage();
    manage.install.mockRejectedValue("checksum mismatch: x");
    await enter(page);

    await act(async () => {
      fireEvent.click(within(page.el).getByRole("button", { name: "Install calendar-ics" }));
    });
    const error = page.el.querySelector<HTMLElement>(".yui-plg-err")!;
    expect(error.querySelector(".yui-plg-err__text")?.textContent).toBe(
      "Could not install. checksum mismatch: x",
    );

    await act(async () => {
      fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    });
    expect(manage.install.mock.calls).toEqual([["calendar-ics"], ["calendar-ics"]]);
  });

  it("deletes a plugin only after its inline confirm", () => {
    const { page, manage } = mountPage();

    act(() => {
      fireEvent.click(within(group(page.el, "browser")).getByRole("button", { name: "Delete" }));
    });
    expect(manage.remove).not.toHaveBeenCalled();
    const confirm = group(page.el, "browser").querySelector<HTMLElement>(".yui-confirm")!;
    expect(confirm.querySelector(".yui-confirm__q")?.textContent).toBe(
      "Delete browser's code and data?",
    );
    expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "Cancel" }));

    act(() => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    });
    expect(manage.remove.mock.calls).toEqual([["browser"]]);
  });

  it("shows a failed delete at the foot of the Installed section after the plugin left the list", async () => {
    const { page, manage, emit } = mountPage();
    manage.remove.mockImplementation(async () => {
      emit({ revision: 2, plugins: SNAPSHOT.plugins.filter((p) => p.id !== "browser") });
      throw "os error 5";
    });

    act(() => {
      fireEvent.click(within(group(page.el, "browser")).getByRole("button", { name: "Delete" }));
    });
    await act(async () => {
      fireEvent.click(
        within(group(page.el, "browser").querySelector<HTMLElement>(".yui-confirm")!).getByRole(
          "button",
          { name: "Delete" },
        ),
      );
    });

    expect(page.el.querySelector(".yui-plg-err__text")?.textContent).toBe(
      "Could not delete it. os error 5",
    );
    expect(page.el.querySelector('[data-pid="browser"]')).toBeNull();
  });

  it("clears a failed delete's error once a plugin is installed", async () => {
    const { page, manage, emit } = mountPage();
    manage.remove.mockImplementation(async () => {
      emit({ revision: 2, plugins: SNAPSHOT.plugins.filter((p) => p.id !== "browser") });
      throw "os error 5";
    });
    await enter(page);
    act(() => {
      fireEvent.click(within(group(page.el, "browser")).getByRole("button", { name: "Delete" }));
    });
    await act(async () => {
      fireEvent.click(
        within(group(page.el, "browser").querySelector<HTMLElement>(".yui-confirm")!).getByRole(
          "button",
          { name: "Delete" },
        ),
      );
    });
    expect(page.el.querySelector(".yui-plg-err")).not.toBeNull();

    await act(async () => {
      fireEvent.click(within(page.el).getByRole("button", { name: "Install calendar-ics" }));
    });

    expect(manage.install.mock.calls).toEqual([["calendar-ics"]]);
    expect(page.el.querySelector(".yui-plg-err")).toBeNull();
  });

  it("shows a plugin's description as text", () => {
    const description = "<img src=x onerror=alert(1)>";
    const { page } = mountPage({ revision: 1, plugins: [plugin({ id: "p1", description })] });

    const sum = group(page.el, "p1").querySelector(".yui-plg-sum")!;
    expect(sum.textContent).toBe(description);
    expect(page.el.querySelector("img")).toBeNull();
  });

  it("says a running plugin's tool count once, on the tools disclosure", () => {
    const { page } = mountPage({
      revision: 1,
      plugins: [
        plugin({
          id: "yui-test",
          source: "local",
          servers: [server("yui-test", "main")],
          tools: ["t1", "t2", "t3", "t4"].map((name) => ({
            name,
            server: "yui-test/main",
            description: null,
            inputSchema: {},
            meta: null,
          })),
          skills: [{ name: "s1", description: "Skill." }],
        }),
      ],
    });

    expect(group(page.el, "yui-test").querySelector(".yui-plg-sv__state")?.textContent).toBe(
      "Running",
    );
    expect(group(page.el, "yui-test").querySelector(".yui-plg-disc")?.textContent).toBe(
      "Tools: 4, skills: 1",
    );
  });

  it("fades a block that appears after the page's first render, and not one already there", () => {
    const { page } = mountPage({
      revision: 1,
      plugins: [
        plugin({
          id: "yui-test",
          source: "local",
          servers: [server("yui-test", "main")],
          tools: [
            {
              name: "t1",
              server: "yui-test/main",
              description: null,
              inputSchema: {},
              meta: null,
            },
          ],
        }),
      ],
    });
    const installed = group(page.el, "yui-test");
    expect(installed.classList.contains("yui-keyed-enter")).toBe(false);

    act(() => {
      fireEvent.click(within(installed).getByRole("button", { name: "Tools: 1" }));
    });

    expect(
      installed
        .querySelector(".yui-plg-tools")!
        .parentElement!.classList.contains("yui-keyed-enter"),
    ).toBe(true);
  });

  it("shows Checking… when a check joins the catalog load in flight", () => {
    const { page, manage } = mountPage();
    manage.catalog.mockReturnValue(new Promise<CatalogEntry[]>(() => {}));
    act(() => {
      page.entered();
    });
    expect(within(page.el).getByRole("button", { name: "Check for updates" })).toBeTruthy();

    act(() => {
      fireEvent.click(within(page.el).getByRole("button", { name: "Check for updates" }));
    });

    expect(page.el.querySelector(".yui-sec__head .yui-plg-busy")?.textContent).toBe("Checking…");
  });

  it("closes the remove confirm on Escape and keeps the key from the window", () => {
    const { page } = mountPage();
    const browser = group(page.el, "browser");

    act(() => {
      fireEvent.click(within(browser).getByRole("button", { name: "Delete" }));
    });
    const cancel = within(browser.querySelector<HTMLElement>(".yui-confirm")!).getByRole("button", {
      name: "Cancel",
    });
    const event = createEvent.keyDown(cancel, { key: "Escape" });

    fireEvent(cancel, event);

    expect(browser.querySelector(".yui-confirm")).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps no step-2 panel when the switch turns the plugin off while enable runs", async () => {
    const fresh = plugin({
      id: "calendar-ics",
      enabled: false,
      consented: false,
      servers: [server("calendar-ics", "calendar-ics", { status: "stopped" })],
    });
    const { page, manage, emit } = mountPage({ revision: 1, plugins: [fresh] });
    let settleEnable: () => void = () => {};
    manage.enable.mockImplementation(async () => {
      emit({
        revision: 2,
        plugins: [
          {
            ...fresh,
            enabled: true,
            consented: true,
            servers: [server("calendar-ics", "calendar-ics")],
          },
        ],
      });
      await new Promise<void>((resolve) => {
        settleEnable = resolve;
      });
    });

    act(() => {
      fireEvent.click(
        within(group(page.el, "calendar-ics")).getByRole("switch", {
          name: "Turn on calendar-ics",
        }),
      );
    });
    act(() => {
      fireEvent.click(
        within(group(page.el, "calendar-ics")).getByRole("button", { name: "Allow" }),
      );
    });
    act(() => {
      fireEvent.click(
        within(group(page.el, "calendar-ics")).getByRole("switch", {
          name: "Turn on calendar-ics",
        }),
      );
    });
    await act(async () => {
      settleEnable();
    });

    expect(group(page.el, "calendar-ics").querySelector(".yui-plg-consent")).toBeNull();
    expect(manage.disable).toHaveBeenCalledWith("calendar-ics");
  });
});
