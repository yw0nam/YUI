/** The Plugins page: the host's installed plugins and the catalog, re-rendered on every change. */

import type { McpHost, McpHostManage, PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import type { Logger } from "../../../logger";
import { createKeyedRender } from "../keyed-render";
import { catalogHtml, type InstallUi } from "./catalog-markup";
import { createCatalogState } from "./catalog-state";
import { installedHtml, type PluginUi } from "./installed-markup";
import "../connection/endpoints-section.css";
import "./plugins-page.css";

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
  const folder: { busy: boolean; error?: string } = { busy: false };

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

  const catalog = createCatalogState({ manage, plugins, render: () => render() });
  const render = createKeyedRender(el, () => {
    const installed = new Set(plugins().map((p) => p.id));
    return (
      installedHtml({
        snapshot: host.snapshot(),
        ui: uiOf,
        updateTo: catalog.updateTo,
        check: catalog.checkState(),
      }) + catalogHtml({ ...catalog.list(installed), install: installOf, folder })
    );
  });

  /** Runs one managing call; a rejection becomes the plugin's error line. */
  async function attempt(
    id: string,
    lead: string,
    call: () => Promise<unknown>,
    retry?: string,
  ): Promise<boolean> {
    const state = uiOf(id);
    state.error = undefined;
    try {
      await call();
      return true;
    } catch (err) {
      state.error = { lead, message: String(err), retry };
      log.warn("plugins.call_failed", { id, lead, error: String(err) });
      return false;
    } finally {
      render();
    }
  }

  async function allow(id: string): Promise<void> {
    const state = uiOf(id);
    state.flow = "enabling";
    const ok = await attempt(id, "plugins.err_enable", () => manage.enable(id));
    if (state.flow !== "enabling") return;
    state.flow = ok ? "enabled" : undefined;
    render();
  }

  function disable(id: string): void {
    uiOf(id).flow = undefined;
    void attempt(id, "plugins.err_disable", () => manage.disable(id));
  }

  async function update(id: string): Promise<void> {
    const state = uiOf(id);
    state.updating = true;
    await attempt(id, "plugins.err_update", () => manage.install(id), "update");
    state.updating = false;
    render();
  }

  async function install(id: string): Promise<void> {
    const state = installOf(id);
    state.installing = true;
    state.error = undefined;
    render();
    try {
      await manage.install(id);
    } catch (err) {
      state.error = String(err);
      log.warn("plugins.install_failed", { id, error: String(err) });
    }
    state.installing = false;
    render();
  }

  async function addLocal(): Promise<void> {
    folder.busy = true;
    folder.error = undefined;
    render();
    try {
      await manage.addLocal();
    } catch (err) {
      folder.error = String(err);
      log.warn("plugins.add_local_failed", { error: String(err) });
    }
    folder.busy = false;
    render();
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
    retry: (id, button) =>
      void attempt(id, "plugins.err_retry", () => manage.retry(button.dataset.sid ?? "")),
    update: (id) => void update(id),
    install: (_, button) => void install(button.dataset.cid ?? ""),
    folder: () => void addLocal(),
    remove: (id) => {
      uiOf(id).confirm = true;
      render(`rm-cancel:${id}`);
    },
    "rm-cancel": (id) => {
      uiOf(id).confirm = false;
    },
    "rm-go": (id) => {
      uiOf(id).confirm = false;
      const lead =
        plugin(id)?.source === "local" ? "plugins.err_remove_local" : "plugins.err_remove";
      void attempt(id, lead, () => manage.remove(id));
    },
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
    check: catalog.check,
    "cat-retry": () => void catalog.load(),
  };

  function onClick(e: MouseEvent): void {
    const button = (e.target as Element | null)?.closest<HTMLButtonElement>("[data-act]");
    if (!button || button.disabled || !el.contains(button)) return;
    const action = actions[button.dataset.act ?? ""];
    if (!action) return;
    action(button.dataset.id ?? "", button);
    render();
  }

  // Escape closes an open step 1 or remove confirm here, so the panel's own Escape does not close the window.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    let closed = false;
    for (const state of ui.values()) {
      if (state.flow !== "step1" && !state.confirm) continue;
      if (state.flow === "step1") state.flow = undefined;
      state.confirm = false;
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
    entered: () => void catalog.load(),
    dispose: () => {
      unsubscribe();
      catalog.dispose();
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeydown);
    },
  };
}
