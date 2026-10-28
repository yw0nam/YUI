/** The webview side of the MCP host: its latest snapshot, and the calling window's call, cancel and skill commands. */

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

/** The snapshot fields the client reads; the host sends more (see #1666 interface comment). */
export interface PluginHostSnapshot {
  revision: number;
  plugins: Array<{
    id: string;
    enabled: boolean;
    tools: PluginHostTool[];
    skills: Array<{ name: string; description: string }>;
  }>;
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
}

const log = createLogger("mcp-host");

export function createMcpHost(): McpHost & { dispose(): void } {
  let latest: PluginHostSnapshot | null = null;
  let unlisten: (() => void) | undefined;
  let disposed = false;

  const keep = (snapshot: PluginHostSnapshot): void => {
    if (latest === null || snapshot.revision > latest.revision) latest = snapshot;
  };

  if (isTauri()) {
    void listen<PluginHostSnapshot>("plugin-host-snapshot", (event) => keep(event.payload)).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
      },
      (err) => log.warn("snapshot_failed", { error: String(err) }),
    );
    void invoke<PluginHostSnapshot>("plugin_host_snapshot").then(keep, (err) =>
      log.warn("snapshot_failed", { error: String(err) }),
    );
  }

  return {
    snapshot: () => latest,
    call: (callId, name, args, presetId) =>
      invoke<PluginToolResult>("plugin_host_call", { callId, name, arguments: args, presetId }),
    cancel: (callId) => invoke<void>("plugin_host_cancel", { callId }),
    skill: (name) => invoke<string>("plugin_host_skill", { name }),
    dispose: () => {
      disposed = true;
      unlisten?.();
    },
  };
}
