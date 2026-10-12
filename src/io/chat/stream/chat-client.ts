/**
 * Chat client — thin ADAPTER over the official `openai` SDK.
 *
 * `streamChat` builds the SDK client and routes to the transport selected by `config.chat_api`:
 * Responses (responses-stream.ts) or Chat Completions (chat-completions-stream.ts). Both map the
 * wire onto `ChatStreamEvent`.
 *
 * Transport: Tauri webview gets CORS bypass + SSE streaming via the fetch injected by tauri-plugin-cors-fetch
 *   (plugin-http cannot stream SSE). `selectFetch()` chooses fetch per environment and injects it into
 *   `StreamChatOptions.fetch` for the SDK. dev/browser use global fetch.
 */

import OpenAI from "openai";

import type {
  ControlEnvelope,
  EndpointsConfig,
  ExpressArgs,
  ToolStatus,
  Usage,
} from "../../../contract";
import { isTauri } from "../../../tauri-env";
import type { CCMessage } from "./chat-completions";
import { streamChatCompletions } from "./chat-completions-stream";
import type { ClientToolRegistry } from "./client-tools";
import { streamResponses } from "./responses-stream";

/** The result of a function call the model never saw answered — the next turn sends it with the response id. */
export interface ToolOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

/** Incremental events streamed to client during parsing. */
export type ChatStreamEvent =
  | { type: "speech_delta"; text: string }
  | { type: "speech_done"; text: string }
  /** The backend's reasoning text as it streams; never spoken, never stored. */
  | { type: "reasoning"; delta: string }
  | { type: "express"; args: ExpressArgs }
  | { type: "tool_status"; status: ToolStatus }
  | { type: "usage"; usage: Usage }
  | {
      type: "completed";
      envelope: ControlEnvelope;
      responseId: string;
      /** Responses only: outputs for the final response's calls that got no round trip. */
      toolOutputs?: ToolOutputItem[];
    }
  | { type: "error"; message: string; status?: number }
  /** any wire activity we don't otherwise consume — resets the caller's idle watchdog without ending "thinking". */
  | { type: "keepalive" };

/**
 * Creates a client via `new OpenAI(opts)`. The real SDK is an ES class requiring `new`,
 * but some test mocks (arrow-wrapped factories) cannot be called as constructors → only
 * for "not a constructor" fallback to plain call. Normal path (real SDK) always uses `new`.
 */
function makeClient(opts: ConstructorParameters<typeof OpenAI>[0]): OpenAI {
  try {
    return new OpenAI(opts);
  } catch (err) {
    if (err instanceof TypeError && /is not a constructor/.test(err.message)) {
      return (OpenAI as unknown as (o: typeof opts) => OpenAI)(opts);
    }
    throw err;
  }
}

export interface ChatRequest {
  /** OpenAI-compatible input (messages / input items). Includes InputContext encoding. */
  input: unknown;
  /** Server-side conversation state (Responses API). */
  previous_response_id?: string;
  /** Responses reasoning.effort / Chat Completions top-level reasoning_effort. Omitted if unset. */
  reasoning_effort?: "none" | "minimal" | "low" | "medium";
  /** instructions runtime override. Non-empty takes precedence over config.chat_instructions. Responses only (CC already in messages). */
  instructions?: string;
  /** Mid-flight abort. */
  signal?: AbortSignal;
  /** Chat Completions mode: pre-assembled messages (chat-completions.buildCCMessages). Used when config.chat_api==="chat_completions". */
  messages?: CCMessage[];
}

export interface StreamChatOptions {
  /**
   * Backend auth key (Bearer). SecretProvider resolves and caller passes it.
   * Unset defaults to unauthenticated local placeholder — backends enforcing keys return 401.
   */
  apiKey?: string;
  /** Transport fetch override. Tauri uses cors-fetch's fetchCORS, dev/browser undefined (global fetch). */
  fetch?: typeof globalThis.fetch;
  /** Client-declared tools. Absent/empty ⇒ no tools declared, no round trip. */
  tools?: ClientToolRegistry;
}

/**
 * Selects fetch per environment. Tauri webview uses `fetchCORS` injected by tauri-plugin-cors-fetch
 * (CORS bypass + SSE streaming). Browser/vitest undefined → global fetch.
 */
export async function selectFetch(): Promise<typeof globalThis.fetch | undefined> {
  const g = globalThis as { fetchCORS?: unknown };
  if (isTauri()) {
    if (typeof g.fetchCORS === "function") return g.fetchCORS as typeof globalThis.fetch;
  }
  return undefined;
}

/**
 * Selects baseURL. Tauri uses absolute URLs directly via cors-fetch. Dev web sends the request through
 * the dev server's `/__backend` mount (scripts/dev-backend-proxy.mjs), which forwards it to the configured
 * host and port without CORS preflight. Prod web passes the URL through unchanged. Chat Completions mode
 * returns the configured URL in every environment.
 */
export function selectChatBaseUrl(
  configuredBaseUrl: string,
  env?: { isTauri?: boolean; isDev?: boolean; origin?: string },
  chatApi?: EndpointsConfig["chat_api"],
): string {
  if (chatApi === "chat_completions") return configuredBaseUrl;

  const g = globalThis as { location?: { origin?: string } };
  const tauriRuntime = env?.isTauri ?? isTauri();
  const isDev = env?.isDev ?? import.meta.env?.DEV;
  const origin = env?.origin ?? g.location?.origin;

  if (tauriRuntime) return configuredBaseUrl;
  if (isDev && origin) {
    const { protocol, host, pathname } = new URL(configuredBaseUrl);
    return `${origin}/__backend/${protocol.slice(0, -1)}/${host}${pathname}`;
  }
  return configuredBaseUrl;
}

/** Builds the SDK client and routes to the transport `config.chat_api` selects. */
export async function* streamChat(
  config: EndpointsConfig,
  request: ChatRequest,
  opts: StreamChatOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  // Abort immediately without hang if signal already aborted.
  if (request.signal?.aborted) return;

  // SDK appends /responses after baseURL, so baseURL is the API root (e.g., .../v1).
  // Unset apiKey defaults to unauthenticated placeholder.
  const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
    baseURL: selectChatBaseUrl(config.chat_base_url, undefined, config.chat_api),
    apiKey: opts.apiKey ?? "yui-local-placeholder",
    dangerouslyAllowBrowser: true,
  };
  if (opts.fetch != null) {
    clientOpts.fetch = opts.fetch;
  }
  const client = makeClient(clientOpts);

  if (config.chat_api === "chat_completions") {
    yield* streamChatCompletions(client, config, request, opts.tools);
    return;
  }
  yield* streamResponses(client, config, request, opts.tools);
}
