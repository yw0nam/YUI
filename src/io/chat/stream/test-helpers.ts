import type { EndpointsConfig } from "../../../contract";
import { createClientToolRegistry } from "../tools/client-tools";
import { type ChatRequest, type StreamChatOptions, streamChat } from "./chat-client";

export function streamChatForTest(
  config: EndpointsConfig,
  request: ChatRequest,
  opts: Partial<StreamChatOptions> = {},
): ReturnType<typeof streamChat> {
  return streamChat(config, request, { tools: createClientToolRegistry([]), ...opts });
}
