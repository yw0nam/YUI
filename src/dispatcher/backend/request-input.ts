/** Pure encoders for the Responses input of a turn: the tagged client_context block and the user item. */
import type { InputContext } from "../../contract";
import type { ChatRequest } from "../../io/chat/chat-client";
import type { BusEnvelope } from "../core/event-bus";
import { backgroundMarker } from "./background-marker";
import { renderClientContext } from "./client-context-text";
import type { buildContext } from "./context-builder";
import { imageDataUrlsOf } from "./context-builder";

/** The tagged client_context block every transport sends. */
export function contextBlock(
  clientContext: Awaited<ReturnType<typeof buildContext>>["clientContext"],
  nowMs: number,
): string {
  return [
    "<client_context>",
    "Client-injected context; not typed by the user.",
    renderClientContext(clientContext, nowMs),
    "</client_context>",
  ].join("\n");
}

/**
 * InputContext → OpenAI Responses input — one user item carrying the tagged client_context
 * block followed by userText ?? backgroundMarker(env.event_name, trigger) (+ image content-parts when
 * images present). The `input` array has no contractual system slot: its last item becomes the
 * turn's user message and earlier items land in plain history, so context rides inside the turn.
 * Context leads and the utterance trails it — recall on the trailing query holds as the block grows.
 */
export function encodeInput(
  ctx: InputContext,
  env: BusEnvelope,
  clientContext: Awaited<ReturnType<typeof buildContext>>["clientContext"],
  nowMs: number,
): ChatRequest["input"] {
  const text = [
    contextBlock(clientContext, nowMs),
    "",
    ctx.user_text ?? backgroundMarker(env.event_name, clientContext.trigger),
  ].join("\n");
  const images = imageDataUrlsOf(ctx);
  const userContent = images.length
    ? [
        { type: "input_text", text },
        ...images.map((image_url) => ({ type: "input_image", image_url })),
      ]
    : text;

  return [{ role: "user", content: userContent }];
}
