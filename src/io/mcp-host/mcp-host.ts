/** The webview side of the MCP host: its latest snapshot, the calling window's call, cancel and skill commands, and the settings window's managing commands. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

/** One declared tool of a running server, as `tools/list` gave it. */
export interface PluginHostTool {
  name: string;
  server: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  meta: Record<string, unknown> | null;
}

export interface PluginHostServer {
  /** `<pluginId>/<serverName>`. */
  id: string;
  name: string;
  status: "starting" | "running" | "failed" | "exited" | "stopped";
  /** The start step a `failed` server stopped at. */
  phase: "spawn" | "initialize" | "list" | null;
  reason: string | null;
  /** The launch command and its arguments after placeholder expansion. */
  command: string;
}

/** A tool or skill name another holder (`"builtin"` or a plugin id) keeps first. */
export interface PluginHostHidden {
  kind: "tool" | "skill";
  name: string;
  holder: string;
}

export interface PluginHostPlugin {
  id: string;
  version: string | null;
  description: string | null;
  source: "local" | "official" | "community";
  path: string;
  enabled: boolean;
  consented: boolean;
  /** Why the manifest could not be read. */
  error: string | null;
  servers: PluginHostServer[];
  tools: PluginHostTool[];
  skills: Array<{ name: string; description: string }>;
  hidden: PluginHostHidden[];
}

/** The host's published state, as `plugin_host_snapshot` and the snapshot event send it. */
export interface PluginHostSnapshot {
  revision: number;
  plugins: PluginHostPlugin[];
}

/** One entry of the plugin catalog. */
export interface CatalogEntry {
  id: string;
  source: "official" | "community";
  version: string | null;
  summary: string | null;
  error: string | null;
}

/** An MCP `tools/call` result, content blocks unchanged. */
export interface PluginToolResult {
  content: Array<Record<string, unknown>>;
  isError: boolean;
}

export interface McpHost {
  /** The newest snapshot seen; null until the first arrives and always outside Tauri. */
  snapshot(): PluginHostSnapshot | null;
  /** Rejects with the host's string (unknown tool, timeout, cancel, server error). */
  call(callId: string, name: string, args: unknown, presetId: string): Promise<PluginToolResult>;
  cancel(callId: string): Promise<void>;
  /** The skill's SKILL.md body; rejects `unknown plugin skill: <name>`. */
  skill(name: string): Promise<string>;
  /** Called with each snapshot newer than the one kept; returns the unsubscribe. */
  subscribe(listener: (snapshot: PluginHostSnapshot) => void): () => void;
}

/** The settings window's managing commands; each rejects with the host's string. */
export interface McpHostManage {
  catalog(): Promise<CatalogEntry[]>;
  install(pluginId: string): Promise<void>;
  remove(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  /** The added plugin's id; null when the folder picker is dismissed. */
  addLocal(): Promise<string | null>;
  retry(serverId: string): Promise<void>;
  logTail(pluginId: string): Promise<string[]>;
  /** Opens the host's plugin log folder in the OS file manager. */
  revealLog(): Promise<void>;
}

export const mcpHostManage: McpHostManage = {
  catalog: () => invoke<CatalogEntry[]>("plugin_host_catalog"),
  install: (pluginId) => invoke<void>("plugin_host_install", { pluginId }),
  remove: (pluginId) => invoke<void>("plugin_host_remove", { pluginId }),
  enable: (pluginId) => invoke<void>("plugin_host_enable", { pluginId }),
  disable: (pluginId) => invoke<void>("plugin_host_disable", { pluginId }),
  addLocal: () => invoke<string | null>("plugin_host_add_local"),
  retry: (serverId) => invoke<void>("plugin_host_retry", { serverId }),
  logTail: (pluginId) => invoke<string[]>("plugin_host_log_tail", { pluginId }),
  revealLog: () => invoke<void>("plugin_host_reveal_log"),
};

const log = createLogger("mcp-host");

export function createMcpHost(): McpHost & { dispose(): void } {
  let latest: PluginHostSnapshot | null = null;
  const listeners = new Set<(snapshot: PluginHostSnapshot) => void>();
  let unlisten: (() => void) | undefined;
  let disposed = false;

  const keep = (snapshot: PluginHostSnapshot): void => {
    if (latest !== null && snapshot.revision <= latest.revision) return;
    latest = snapshot;
    for (const listener of listeners) listener(snapshot);
  };

  // The read follows the subscription, so no event is lost between the two.
  const read = (): void => {
    void invoke<PluginHostSnapshot>("plugin_host_snapshot").then(keep, (err) =>
      log.warn("snapshot.invoke_failed", { error: String(err) }),
    );
  };

  if (isTauri()) {
    void listen<PluginHostSnapshot>("plugin-host-snapshot", (event) => keep(event.payload)).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
        read();
      },
      (err) => {
        log.warn("snapshot.listen_failed", { error: String(err) });
        read();
      },
    );
  }

  return {
    snapshot: () => latest,
    call: (callId, name, args, presetId) =>
      invoke<PluginToolResult>("plugin_host_call", { callId, name, arguments: args, presetId }),
    cancel: (callId) => invoke<void>("plugin_host_cancel", { callId }),
    skill: (name) => invoke<string>("plugin_host_skill", { name }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      unlisten?.();
    },
  };
}
