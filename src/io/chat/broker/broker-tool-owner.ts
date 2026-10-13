// Deprecated: removed in v0.6.0. Use client-declared tools (src/io/chat/tools/client-tools.ts).
import type { EndpointsConfig } from "../../../contract";
import type { ClientToolRegistry } from "../tools/client-tools";

/**
 * On Responses, a configured broker means the backend owns generate_express, so the client declares
 * no tools and answers nothing. Chat Completions and push keep the client's tools.
 */
export function clientToolsUnlessBrokered(
  endpoints: EndpointsConfig,
  tools: ClientToolRegistry,
): ClientToolRegistry | undefined {
  const brokered = (endpoints.broker_base_url ?? "").trim() !== "";
  const responses = endpoints.chat_api === undefined || endpoints.chat_api === "responses";
  return brokered && responses ? undefined : tools;
}
