import type { ControlEnvelope, EmotionId, ExpressArgs } from "../../contract";

/**
 * Identifies express tool — when backend registers via MCP, name arrives as `mcp_<server>_generate_express`.
 * Matches by suffix to catch both namespaced/plain variants, while sibling tools
 * (`..._get_ids` etc) remain as generic tool_status.
 */
export function isExpressTool(name: unknown): boolean {
  return typeof name === "string" && name.endsWith("generate_express");
}

/** Extracts openai SDK APIError.status (HTTP status code) — undefined if absent (plain Error etc). */
export function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Server-side error text: the SDK's APIError message leads with "<status> " — strip it so
 * the bare body message remains. Errors without a status keep their text unchanged.
 */
export function serverMessageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = httpStatusOf(err);
  return status !== undefined && raw.startsWith(`${status} `)
    ? raw.slice(String(status).length + 1)
    : raw;
}

/** FLAT express args → renderer seam shape. Only present fields are normalized (no invention). */
export function normalizeExpressIntoEnvelope(
  envelope: ControlEnvelope,
  express: ExpressArgs | undefined,
): void {
  if (!express) return;
  if (express.emotion_id !== undefined) envelope.emotion = { id: express.emotion_id as EmotionId };
  if (express.motion_id !== undefined) envelope.motion = { id: express.motion_id };
  if (express.emotion_text !== undefined) envelope.emotion_text = express.emotion_text;
  if (express.caption !== undefined) envelope.caption = express.caption;
}
