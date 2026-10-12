import type { ChatRequest, ToolOutputItem } from "../../io/chat/stream/chat-client";

/** The outputs of the stored response's unanswered calls lead the input that continues from it. */
export function withPendingOutputs(
  input: ChatRequest["input"],
  outputs: readonly ToolOutputItem[],
): ChatRequest["input"] {
  return outputs.length ? [...outputs, ...(input as unknown[])] : input;
}
