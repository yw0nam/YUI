import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";
import type { ClientToolResult } from "../../tools/client-tools";

export function responseToolOutput(
  result: ClientToolResult,
): string | ResponseFunctionCallOutputItemList {
  if (typeof result === "string") return result;
  return [
    { type: "input_text", text: result.text },
    ...result.images.map((image_url): ResponseFunctionCallOutputItemList[number] => ({
      type: "input_image",
      image_url,
      detail: "auto",
    })),
  ];
}
