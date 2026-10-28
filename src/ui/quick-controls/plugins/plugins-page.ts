/** The Plugins page: the host's installed plugins and the catalog, re-rendered on every change. */

import type {
  CatalogEntry,
  McpHost,
  McpHostManage,
  PluginHostPlugin,
} from "../../../io/mcp-host/mcp-host";
import type { Logger } from "../../../logger";
import { type CatalogView, catalogHtml, type InstallUi } from "./catalog-markup";
import { type CheckState, installedHtml, type PluginUi } from "./installed-markup";
import "./plugins-page.css";

/** How long "Check for updates" shows its result. */
const CHECK_RESULT_MS = 4000;

export interface PluginsPage {
  el: HTMLElement;
  /** The page was entered: the catalog loads unless a load is in flight. */
  entered(): void;
  dispose(): void;
}

export function createPluginsPage(deps: {
  host: McpHost;
  manage: McpHostManage;
  log: Logger;
}): PluginsPage {
  const { host, manage, log } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";

  const ui = new Map<string, PluginUi>();
  const installs = new Map<string, InstallUi>();
  const catalog: { state: CatalogView["state"]; entries: CatalogEntry[]; error: string } = {
    state: "loading",
    entries: [],
    error: "",
  };
  let catalogLoad: Promise<void> | null = null;
  let check: CheckState = null;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;

  const uiOf = (id: string): PluginUi => {
    let state = ui.get(id);
    if (!state) ui.set(id, (state = {}));
    return state;
  };
  const installOf = (id: string): InstallUi => {
    let state = installs.get(id);
    if (!state) installs.set(id, (state = {}));
    return state;
  };
  const plugins = (): PluginHostPlugin[] => host.snapshot()?.plugins ?? [];
  const plugin = (id: string): PluginHostPlugin | undefined => plugins().find((p) => p.id === id);

  function updateTo(p: PluginHostPlugin): string | null {
    if (p.source === "local" || catalog.state !== "ok") return null;
    const entry = catalog.entries.find((c) => c.id === p.id);
    return entry?.version && p.version && entry.version !== p.version ? entry.version : null;
  }

  // Each render replaces the markup; these carry what the previous one showed.
  const seen = new Set<string>();
  const switches = new Map<string, string>();
  let rendered = false;

  function render(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && el.contains(active) ? active.dataset.fk : "";
    const installed = new Set(plugins().map((p) => p.id));
    el.innerHTML =
      installedHtml({ snapshot: host.snapshot(), ui: uiOf, updateTo, check }) +
      catalogHtml({
        state: catalog.state,
        entries: catalog.entries.filter((c) => !installed.has(c.id)),
        error: catalog.error,
        install: installOf,
        folder: { busy: false },
      });

    // A block fades in only on the render it first shows up in.
    const now = new Set<string>();
    for (const block of el.querySelectorAll<HTMLElement>("[data-k]")) {
      const key = block.dataset.k ?? "";
      now.add(key);
      if (rendered && !seen.has(key)) block.classList.add("yui-plg-enter");
    }
    seen.clear();
    for (const key of now) seen.add(key);
    rendered = true;

    // A switch slides from where the previous render left it.
    for (const sw of el.querySelectorAll<HTMLElement>(".yui-switch[data-id]")) {
      const id = sw.dataset.id ?? "";
      const value = sw.getAttribute("aria-checked") ?? "";
      const prev = switches.get(id);
      if (prev !== undefined && prev !== value) {
        sw.setAttribute("aria-checked", prev);
        void sw.offsetWidth;
        sw.setAttribute("aria-checked", value);
      }
      switches.set(id, value);
    }

    if (focusKey) {
      const target = Array.from(el.querySelectorAll<HTMLElement>("[data-fk]")).find(
        (node) => node.dataset.fk === focusKey,
      );
      target?.focus({ preventScroll: true });
    }
  }

  function loadCatalog(): Promise<void> {
    if (catalogLoad) return catalogLoad;
    if (catalog.state !== "ok") catalog.state = "loading";
    render();
    catalogLoad = manage.catalog().then(
      (entries) => {
        catalog.entries = entries;
        catalog.state = "ok";
      },
      (err) => {
        catalog.state = "error";
        catalog.error = String(err);
      },
    );
    catalogLoad = catalogLoad.finally(() => {
      catalogLoad = null;
      render();
    });
    return catalogLoad;
  }

  /** Runs one managing call; a rejection becomes the plugin's error line. */
  async function attempt(id: string, lead: string, call: () => Promise<unknown>): Promise<boolean> {
    const state = uiOf(id);
    state.error = undefined;
    try {
      await call();
      return true;
    } catch (err) {
      state.error = { lead, message: String(err) };
      log.warn("plugins.call_failed", { id, lead, error: String(err) });
      return false;
    } finally {
      render();
    }
  }

  // The host resolves once the servers' start attempts settle, so the snapshot then names the outcome.
  async function allow(id: string): Promise<void> {
    const state = uiOf(id);
    state.flow = "starting";
    const ok = await attempt(id, "plugins.err_enable", () => manage.enable(id));
    if (state.flow !== "starting") return;
    const failed = plugin(id)?.servers.some(
      (sv) => sv.status === "failed" || sv.status === "exited",
    );
    state.flow = !ok ? undefined : failed ? "failed" : "step2";
    render();
  }

  function disable(id: string): void {
    uiOf(id).flow = undefined;
    void attempt(id, "plugins.err_disable", () => manage.disable(id));
  }

  function readLog(id: string): void {
    void manage.logTail(id).then(
      (lines) => {
        uiOf(id).log = { lines };
        render();
      },
      (err) => {
        uiOf(id).log = { error: String(err) };
        render();
      },
    );
  }

  const actions: Record<string, (id: string, button: HTMLElement) => void> = {
    toggle: (id) => {
      const p = plugin(id);
      const state = uiOf(id);
      if (!p) return;
      if (state.flow === "step1") state.flow = undefined;
      else if (p.enabled && p.consented) disable(id);
      // The host keeps an approved path's consent across a disable.
      else if (p.consented) void attempt(id, "plugins.err_enable", () => manage.enable(id));
      else state.flow = "step1";
    },
    reapprove: (id) => {
      uiOf(id).flow = "step1";
    },
    allow: (id) => void allow(id),
    cancel: (id) => {
      uiOf(id).flow = undefined;
    },
    done: (id) => {
      uiOf(id).flow = undefined;
    },
    off: disable,
    tools: (id) => {
      const state = uiOf(id);
      state.toolsOpen = !state.toolsOpen;
    },
    log: (id) => {
      const state = uiOf(id);
      state.logOpen = !state.logOpen;
      if (state.logOpen) readLog(id);
    },
    reveal: (id) => {
      void manage.revealLog().then(
        () => {
          uiOf(id).revealError = undefined;
          render();
        },
        (err) => {
          uiOf(id).revealError = String(err);
          render();
        },
      );
    },
    check: () => {
      check = "busy";
      void loadCatalog().then(() => {
        check =
          catalog.state === "ok" ? { updates: plugins().filter((p) => updateTo(p)).length } : null;
        render();
        checkTimer = setTimeout(() => {
          check = null;
          render();
        }, CHECK_RESULT_MS);
      });
    },
    "cat-retry": () => void loadCatalog(),
  };

  function onClick(e: MouseEvent): void {
    const button = (e.target as Element | null)?.closest<HTMLButtonElement>("[data-act]");
    if (!button || button.disabled || !el.contains(button)) return;
    const action = actions[button.dataset.act ?? ""];
    if (!action) return;
    action(button.dataset.id ?? "", button);
    render();
  }

  // Escape closes an open step 1 here, so the panel's own Escape does not close the window.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    let closed = false;
    for (const state of ui.values()) {
      if (state.flow !== "step1") continue;
      state.flow = undefined;
      closed = true;
    }
    if (!closed) return;
    e.preventDefault();
    e.stopPropagation();
    render();
  }

  el.addEventListener("click", onClick);
  el.addEventListener("keydown", onKeydown);
  const unsubscribe = host.subscribe(() => {
    for (const [id, state] of ui) if (state.logOpen) readLog(id);
    render();
  });
  render();

  return {
    el,
    entered: () => void loadCatalog(),
    dispose: () => {
      unsubscribe();
      clearTimeout(checkTimer);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeydown);
    },
  };
}
