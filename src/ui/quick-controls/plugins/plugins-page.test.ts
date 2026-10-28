// @vitest-environment jsdom
/**
 * plugins-page.test.ts — the Plugins page over the plugin host's snapshot, catalog and commands.
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

    expect(Array.from(page.el.querySelectorAll("[data-pid]"), (g) => g.dataset.pid)).toEqual([
      "browser",
      "yui-test",
      "weather",
    ]);
    expect(group(page.el, "browser").querySelector(".yui-plg-hid")?.textContent).toBe(
      "Hidden tool browser — a built-in tool uses this name",
    );
    const weather = group(page.el, "weather");
    expect(button(weather, "Allow again…").dataset.act).toBe("reapprove");
    expect(weather.querySelector(".yui-plg-sv")).toBeNull();
    expect(button(weather, "Update to v0.5.0").dataset.act).toBe("update");
    expect(Array.from(page.el.querySelectorAll("[data-cid]"), (b) => b.dataset.cid)).toEqual([
      "calendar-ics",
    ]);
  });
});
