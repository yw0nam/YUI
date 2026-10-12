import { fitTurnImages } from "../fit-turn-images";
import type { ToolCallFrame, ToolResultFrame } from "../push-frames";
import { byteLength, PUSH_FRAME_MAX_BYTES } from "../push-socket";

const TOO_LARGE = "error: result too large";

/** A text-only result keeps the 256 KiB frame cap. */
export function textToolResult(call: ToolCallFrame, result: string): ToolResultFrame {
  const reply: ToolResultFrame = {
    type: "tool_result",
    id: call.id,
    turn_id: call.turn_id,
    result,
  };
  return byteLength(JSON.stringify(reply)) > PUSH_FRAME_MAX_BYTES
    ? { ...reply, result: TOO_LARGE }
    : reply;
}

/** A result with images is fitted to the turn byte cap; nothing that fits becomes the error text. */
export async function imageToolResult(
  call: ToolCallFrame,
  result: { text: string; images: string[] },
  maxTurnBytes: number = PUSH_FRAME_MAX_BYTES,
): Promise<ToolResultFrame> {
  const reply: ToolResultFrame = {
    type: "tool_result",
    id: call.id,
    turn_id: call.turn_id,
    result: result.text,
    images: [],
  };
  reply.images = await fitTurnImages(
    result.images,
    maxTurnBytes - byteLength(JSON.stringify(reply)),
  );
  return byteLength(JSON.stringify(reply)) > maxTurnBytes
    ? { type: "tool_result", id: call.id, turn_id: call.turn_id, result: TOO_LARGE }
    : reply;
}
