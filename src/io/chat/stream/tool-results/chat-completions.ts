import { type ClientToolResult, toolResultText } from "../../tools/client-tools";
import type { CCMessage } from "../chat-completions";

const IMAGE_FOLLOWS = "The image follows in the next user message.";

export function completionToolResults(
  executed: ReadonlyArray<{ call: { id: string }; result: ClientToolResult }>,
): CCMessage[] {
  const messages: CCMessage[] = executed.map(({ call, result }) => ({
    role: "tool",
    tool_call_id: call.id,
    content:
      typeof result === "string" || result.images.length === 0
        ? toolResultText(result)
        : `${result.text}. ${IMAGE_FOLLOWS}`,
  }));
  const images = executed.flatMap(({ result }) =>
    typeof result === "string" ? [] : result.images,
  );
  if (images.length)
    messages.push({
      role: "user",
      content: images.map((url) => ({ type: "image_url", image_url: { url } })),
    });
  return messages;
}
