/** The Plugins page's state and actions, kept outside React. */

import type {
  McpHost,
  McpHostManage,
  PluginHostPlugin,
  PluginHostSnapshot,
} from "../../../io/mcp-host/mcp-host";
import type { Logger } from "../../../logger";
import { type CatalogState, createCatalogState } from "./catalog-state";
import { type Failure, SOURCES } from "./plugin-parts";

/** What the page holds for one installed plugin beside the snapshot. */
export interface PluginUi {
  /** The consent panel: step 1 asks, enable runs, then the snapshot picks the step-2 panel. */
  flow?: "step1" | "enabling" | "enabled";
  /** The inline remove confirm is open. */
  confirm?: boolean;
  /** An update is in flight. */
  updating?: boolean;
  /** The last managing call's rejection. */
  error?: Failure;
  toolsOpen?: boolean;
  logOpen?: boolean;
  /** The log tail once read, or the host's rejection. */
  log?: { lines: string[] } | { error: string };
  revealError?: string;
}

/** An install started from a catalog row: in flight, or the host's rejection. */
export interface InstallUi {
  installing?: boolean;
  error?: Failure;
}

export interface PluginsState {
  subscribe(listener: () => void): () => void;
  /** Changes on every state change. */
  version(): number;
  snapshot(): PluginHostSnapshot | null;
  uiOf(id: string): PluginUi;
  installOf(id: string): InstallUi;
  /** A delete's rejection, kept here because the plugin has left the list by then. */
  removal: { error?: Failure };
  /** Add from folder: in flight, or the host's rejection. */
  folder: { busy: boolean; error?: Failure };
  catalog: CatalogState;
  /** Loads the catalog unless a load is in flight. */
  load(): void;
  toggle(id: string): void;
  reapprove(id: string): void;
  allow(id: string): void;
  cancel(id: string): void;
  done(id: string): void;
  off(id: string): void;
  retry(id: string, serverId: string): void;
  update(id: string): void;
  install(id: string): void;
  addFolder(): void;
  remove(id: string): void;
  rmCancel(id: string): void;
  rmGo(id: string): void;
  tools(id: string): void;
  log(id: string): void;
  reveal(id: string): void;
  check(): void;
  catRetry(): void;
  /** Clears every open step 1 and remove confirm; true when one was open. */
  escape(): boolean;
  dispose(): void;
}

/** The entry for `id`, made empty on first use. */
function stateOf<T extends object>(map: Map<string, T>, id: string): T {
  let state = map.get(id);
  if (!state) map.set(id, (state = {} as T));
  return state;
}

export function createPluginsState(deps: {
  host: McpHost;
  manage: McpHostManage;
  log: Logger;
}): PluginsState {
  const { host, manage, log } = deps;
  const ui = new Map<string, PluginUi>();
  const installs = new Map<string, InstallUi>();
  /** A delete's rejection, kept here because the plugin has left the list by then. */
  const removal: { error?: Failure } = {};
  const folder: { busy: boolean; error?: Failure } = { busy: false };
  const listeners = new Set<() => void>();
  let revision = 0;

  function notify(): void {
    revision++;
    for (const listener of listeners) listener();
  }

  const uiOf = (id: string): PluginUi => stateOf(ui, id);
  const installOf = (id: string): InstallUi => stateOf(installs, id);
  const plugins = (): PluginHostPlugin[] => host.snapshot()?.plugins ?? [];
  const plugin = (id: string): PluginHostPlugin | undefined => plugins().find((p) => p.id === id);

  const catalog = createCatalogState({ manage, plugins, notify });

  /** Runs one managing call for `subject`; a rejection becomes `holder`'s error line. */
  async function attempt(
    subject: string,
    holder: { error?: Failure },
    lead: string,
    call: () => Promise<unknown>,
    retry?: string,
  ): Promise<boolean> {
    holder.error = undefined;
    try {
      await call();
      return true;
    } catch (err) {
      holder.error = { lead, message: String(err), retry };
      log.warn("plugins.call_failed", { subject, lead, error: String(err) });
      return false;
    } finally {
      notify();
    }
  }

  async function allowFlow(id: string): Promise<void> {
    const state = uiOf(id);
    state.flow = "enabling";
    const ok = await attempt(id, state, "plugins.err_enable", () => manage.enable(id));
    if (state.flow !== "enabling") return;
    state.flow = ok ? "enabled" : undefined;
    notify();
  }

  function disable(id: string): void {
    uiOf(id).flow = undefined;
    void attempt(id, uiOf(id), "plugins.err_disable", () => manage.disable(id));
  }

  async function updateFlow(id: string): Promise<void> {
    const state = uiOf(id);
    state.updating = true;
    await attempt(id, state, "plugins.err_update", () => manage.install(id), "update");
    state.updating = false;
    notify();
  }

  async function installFlow(id: string): Promise<void> {
    removal.error = undefined;
    const state = installOf(id);
    state.installing = true;
    await attempt(id, state, "plugins.err_install", () => manage.install(id));
    state.installing = false;
    notify();
  }

  async function addLocal(): Promise<void> {
    removal.error = undefined;
    folder.busy = true;
    notify();
    await attempt("folder", folder, "plugins.err_folder", () => manage.addLocal());
    folder.busy = false;
    notify();
  }

  function readLog(id: string): void {
    void manage.logTail(id).then(
      (lines) => {
        uiOf(id).log = { lines };
        notify();
      },
      (err) => {
        uiOf(id).log = { error: String(err) };
        notify();
      },
    );
  }

  const unsubscribeHost = host.subscribe(() => {
    for (const [id, state] of ui) if (state.logOpen) readLog(id);
    notify();
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => revision,
    snapshot: () => host.snapshot(),
    uiOf,
    installOf,
    removal,
    folder,
    catalog,
    load: () => void catalog.load(),
    toggle(id) {
      const p = plugin(id);
      const state = uiOf(id);
      if (!p) return;
      if (state.flow === "step1") state.flow = undefined;
      else if (p.enabled && p.consented) disable(id);
      // The host keeps an approved path's consent across a disable.
      else if (p.consented) void attempt(id, state, "plugins.err_enable", () => manage.enable(id));
      else state.flow = "step1";
      notify();
    },
    reapprove(id) {
      uiOf(id).flow = "step1";
      notify();
    },
    allow(id) {
      void allowFlow(id);
      notify();
    },
    cancel(id) {
      uiOf(id).flow = undefined;
      notify();
    },
    done(id) {
      uiOf(id).flow = undefined;
      notify();
    },
    off(id) {
      disable(id);
      notify();
    },
    retry(id, serverId) {
      void attempt(id, uiOf(id), "plugins.err_retry", () => manage.retry(serverId));
      notify();
    },
    update(id) {
      void updateFlow(id);
      notify();
    },
    install(id) {
      void installFlow(id);
      notify();
    },
    addFolder() {
      void addLocal();
    },
    remove(id) {
      uiOf(id).confirm = true;
      notify();
    },
    rmCancel(id) {
      uiOf(id).confirm = false;
      notify();
    },
    rmGo(id) {
      uiOf(id).confirm = false;
      const p = plugin(id);
      if (p) void attempt(id, removal, SOURCES[p.source].removeFailed, () => manage.remove(id));
      notify();
    },
    tools(id) {
      const state = uiOf(id);
      state.toolsOpen = !state.toolsOpen;
      notify();
    },
    log(id) {
      const state = uiOf(id);
      state.logOpen = !state.logOpen;
      if (state.logOpen) readLog(id);
      notify();
    },
    reveal(id) {
      void manage.revealLog().then(
        () => {
          uiOf(id).revealError = undefined;
          notify();
        },
        (err) => {
          uiOf(id).revealError = String(err);
          notify();
        },
      );
    },
    check: () => catalog.check(),
    catRetry: () => void catalog.load(),
    escape() {
      let closed = false;
      for (const state of ui.values()) {
        if (state.flow !== "step1" && !state.confirm) continue;
        if (state.flow === "step1") state.flow = undefined;
        state.confirm = false;
        closed = true;
      }
      if (closed) notify();
      return closed;
    },
    dispose() {
      unsubscribeHost();
      catalog.dispose();
      listeners.clear();
    },
  };
}
