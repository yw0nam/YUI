// Deprecated: removed in v0.6.0. Use client-declared tools (src/io/chat/stream/client-tools.ts).
import type { EndpointsConfig } from "../../../contract";
import type { ClientToolRegistry } from "../stream/client-tools";

/**
 * On Responses, a configured broker means the backend owns generate_express, so the client declares
 * no tools and answers nothing. Chat Completions never reaches the broker's backend tool.
 */
export function clientToolsUnlessBrokered(
  endpoints: EndpointsConfig,
  tools: ClientToolRegistry,
): ClientToolRegistry | undefined {
  const brokered = (endpoints.broker_base_url ?? "").trim() !== "";
  return brokered && endpoints.chat_api !== "chat_completions" ? undefined : tools;
}
