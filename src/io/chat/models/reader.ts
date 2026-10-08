/**
 * Reads the chat server's OpenAI-compatible `/models` list — inputs in, one settled result out.
 * Every failure is a result kind, not a throw; the caller's own abort is the one rejection.
 */

import { createDeadlineSignal, untilAborted } from "../../voice/deadline";

export type ModelListResult =
  | { kind: "ok"; ids: string[] }
  | { kind: "unreachable" }
  | { kind: "timeout" }
  | { kind: "refused" } // HTTP 401 or 403
  | { kind: "no_list" } // HTTP 404
  | { kind: "http"; status: number } // any other non-2xx
  | { kind: "malformed" }; // 2xx whose body fails the parsing rule

const DEFAULT_TIMEOUT_MS = 10_000;

// selectFetch()'s native fetch (tauri-plugin-cors-fetch) takes maxRedirections; 0 builds a no-redirect
// policy the standard RequestInit type doesn't declare.
type FetchInit = RequestInit & { maxRedirections?: number };

// A 2xx body parses when it is a JSON object whose data lists objects with a nonempty string id;
// data:null with object:"list" is the empty list. Returns ids in body order, deduplicated, or null.
function parseModelIds(text: string): string[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { data, object } = body as { data?: unknown; object?: unknown };
  if (data === null) return object === "list" ? [] : null;
  if (!Array.isArray(data)) return null;
  const ids: string[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) return null;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function readModels(input: {
  baseUrl: string;
  apiKey?: string;
  signal: AbortSignal;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number; // default 10_000
}): Promise<ModelListResult> {
  const deadline = createDeadlineSignal(
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "Model list request timed out",
  );
  try {
    const headers: Record<string, string> = {};
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    // One budget over connection and body read; the caller's abort passes through as a rejection.
    const requestSignal = AbortSignal.any([input.signal, deadline.signal]);
    const init: FetchInit = {
      headers,
      signal: requestSignal,
      redirect: "error",
      maxRedirections: 0,
    };
    const res = await untilAborted(
      input.fetch(`${input.baseUrl.replace(/\/+$/, "")}/models`, init),
      requestSignal,
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { kind: "refused" };
      if (res.status === 404) return { kind: "no_list" };
      return { kind: "http", status: res.status };
    }
    const body = await untilAborted(res.text(), requestSignal);
    const ids = parseModelIds(body);
    return ids === null ? { kind: "malformed" } : { kind: "ok", ids };
  } catch (err) {
    if (input.signal.aborted) throw err;
    if (deadline.signal.aborted) return { kind: "timeout" };
    return { kind: "unreachable" };
  } finally {
    deadline.clear();
  }
}
