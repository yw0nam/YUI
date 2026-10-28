/**
 * The proto tools' door to the Rust MCP host (issue #1648 prototype, throwaway).
 *
 * The host speaks MCP stdio with rmcp; the webview sees two Tauri commands: one call with the
 * calling preset's id, one cancel by call id. Results arrive as the CallToolResult JSON.
 */

import { invoke } from "@tauri-apps/api/core";

/** One content block of a CallToolResult, as the JSON the Rust host returns. */
export interface ProtoMcpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ProtoMcpCallResult {
  content: ProtoMcpContentBlock[];
  isError: boolean;
}

export interface ProtoMcpRelay {
  /** Calls one tool on the hosted server; the preset id rides in `_meta` to the server. */
  call(
    tool: string,
    args: Record<string, unknown>,
    presetId: string,
    callId: string,
  ): Promise<ProtoMcpCallResult>;
  /** Cancels one in-flight call: the host sends `notifications/cancelled` for it. */
  cancel(callId: string): Promise<void>;
}

export function createProtoMcpRelay(): ProtoMcpRelay {
  return {
    call: (tool, args, presetId, callId) =>
      invoke<ProtoMcpCallResult>("proto_mcp_call", { tool, args, presetId, callId }),
    cancel: (callId) => invoke<void>("proto_mcp_cancel", { callId }),
  };
}
