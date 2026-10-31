// @vitest-environment jsdom
/**
 * plugins-page.test.ts — the Plugins page over the MCP host's snapshot, catalog and commands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogEntry,
  PluginHostPlugin,
  PluginHostServer,
  PluginHostSnapshot,
} from "../../../io/mcp-host/mcp-host";
import { setLocale } from "../../i18n";
import { fakePlugins } from "../test-helpers";
import { createPluginsPage } from "./plugins-page";

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

function mountPage(snapshot: PluginHostSnapshot | null = SNAPSHOT) {
  const fake = fakePlugins(snapshot);
  fake.manage.catalog.mockResolvedValue(CATALOG);
  const page = createPluginsPage({ host: fake.host, manage: fake.manage, log });
  document.body.append(page.el);
  return { ...fake, page };
}

const group = (el: HTMLElement, id: string): HTMLElement =>
  el.querySelector<HTMLElement>(`[data-pid="${id}"]`)!;

const button = (root: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;

describe("createPluginsPage", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists the installed plugins and the catalog entries not installed", async () => {
    const { page } = mountPage();
    page.entered();
    await vi.waitFor(() => expect(page.el.textContent).toContain("calendar-ics"));

    expect(
      Array.from(page.el.querySelectorAll<HTMLElement>("[data-pid]"), (g) => g.dataset.pid),
    ).toEqual(["browser", "yui-test", "weather"]);
    expect(group(page.el, "browser").querySelector(".yui-plg-hid")?.textContent).toBe(
      "Hidden tool browser: a built-in tool uses this name",
    );
    const weather = group(page.el, "weather");
    expect(button(weather, "Allow again…").dataset.act).toBe("reapprove");
    expect(weather.querySelector(".yui-plg-sv")).toBeNull();
    expect(button(weather, "Update to v0.5.0").dataset.act).toBe("update");
    expect(
      Array.from(page.el.querySelectorAll<HTMLElement>("[data-cid]"), (b) => b.dataset.cid),
    ).toEqual(["calendar-ics"]);
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

    group(page.el, "calendar-ics").querySelector<HTMLButtonElement>(".yui-switch")!.click();
    const consent = group(page.el, "calendar-ics").querySelector<HTMLElement>(".yui-plg-consent")!;
    expect(consent.querySelector(".yui-plg-cmd")?.textContent).toBe(
      "/plugins/calendar-ics/bin/calendar-ics --stdio",
    );

    button(consent, "Allow").click();
    expect(manage.enable).toHaveBeenCalledWith("calendar-ics");
    await vi.waitFor(() =>
      expect(
        Array.from(
          group(page.el, "calendar-ics").querySelectorAll(".yui-plg-consent .yui-plg-tools__name"),
          (n) => n.textContent,
        ),
      ).toEqual(["calendar_today"]),
    );
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

    group(page.el, "calendar-ics").querySelector<HTMLButtonElement>(".yui-switch")!.click();
    button(group(page.el, "calendar-ics"), "Allow").click();
    // enable has resolved and the page has settled while the snapshot still says starting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit(started("failed", 3));

    expect(question()).toBe("Some servers could not start.");
  });

  it("shows an install rejection as the host sent it, with a Retry that installs again", async () => {
    const { page, manage } = mountPage();
    manage.install.mockRejectedValue("checksum mismatch: x");
    page.entered();
    await vi.waitFor(() =>
      expect(page.el.querySelector('[data-cid="calendar-ics"]')).not.toBeNull(),
    );

    page.el.querySelector<HTMLButtonElement>('[data-cid="calendar-ics"]')!.click();
    await vi.waitFor(() =>
      expect(page.el.querySelector(".yui-plg-err span")?.textContent).toBe(
        "Could not install. checksum mismatch: x",
      ),
    );

    button(page.el.querySelector<HTMLElement>(".yui-plg-err")!, "Retry").click();
    expect(manage.install.mock.calls).toEqual([["calendar-ics"], ["calendar-ics"]]);
  });

  it("deletes a plugin only after its inline confirm", () => {
    const { page, manage } = mountPage();

    button(group(page.el, "browser"), "Delete").click();
    expect(manage.remove).not.toHaveBeenCalled();
    const confirm = group(page.el, "browser").querySelector<HTMLElement>(".yui-confirm")!;
    expect(confirm.querySelector(".yui-confirm__q")?.textContent).toBe(
      "Delete browser's code and data?",
    );

    button(confirm, "Delete").click();
    expect(manage.remove.mock.calls).toEqual([["browser"]]);
  });

  it("shows a failed delete at the foot of the Installed section after the plugin left the list", async () => {
    const { page, manage, emit } = mountPage();
    manage.remove.mockImplementation(async () => {
      emit({ revision: 2, plugins: SNAPSHOT.plugins.filter((p) => p.id !== "browser") });
      throw "os error 5";
    });

    button(group(page.el, "browser"), "Delete").click();
    button(group(page.el, "browser").querySelector<HTMLElement>(".yui-confirm")!, "Delete").click();

    await vi.waitFor(() =>
      expect(page.el.querySelector(".yui-plg-err span")?.textContent).toBe(
        "Could not delete it. os error 5",
      ),
    );
    expect(page.el.querySelector('[data-pid="browser"]')).toBeNull();
  });

  it("clears a failed delete's error once a plugin is installed", async () => {
    const { page, manage, emit } = mountPage();
    manage.remove.mockImplementation(async () => {
      emit({ revision: 2, plugins: SNAPSHOT.plugins.filter((p) => p.id !== "browser") });
      throw "os error 5";
    });
    page.entered();
    await vi.waitFor(() =>
      expect(page.el.querySelector('[data-cid="calendar-ics"]')).not.toBeNull(),
    );
    button(group(page.el, "browser"), "Delete").click();
    button(group(page.el, "browser").querySelector<HTMLElement>(".yui-confirm")!, "Delete").click();
    await vi.waitFor(() => expect(page.el.querySelector(".yui-plg-err")).not.toBeNull());

    page.el.querySelector<HTMLButtonElement>('[data-cid="calendar-ics"]')!.click();

    await vi.waitFor(() => expect(manage.install.mock.calls).toEqual([["calendar-ics"]]));
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
});
