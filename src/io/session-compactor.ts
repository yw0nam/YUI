/**
 * Hermes session compaction write-only client. Asks Hermes to compress a session and reports the
 * rotation result; it never mutates the store and never throws to the caller (transport/parse/abort
 * failures all degrade to a warn log + `{ status: "error" }`). The dispatcher owns the timeout and
 * applies the returned id to the store — this module is stateless and best-effort.
 *
 * Endpoint: `POST {origin}/api/sessions/{id}/compress`, where origin is derived from chat_base_url
 * (`http://host:port/v1` → `http://host:port`). Auth mirrors chat-client (`Authorization: Bearer`
 * when an apiKey is present). The body session_id is the source of truth for the rotation target;
 * the X-Hermes-Session-Id response header is a fallback.
 */

import type { EndpointsConfig, SessionCompressionResponse } from "../contract";
import { createLogger, type Logger } from "../logger";

export interface CompactResult {
  status: "compressed" | "skipped" | "error";
  session_id?: string;
  before_tokens?: number;
  after_tokens?: number;
  removed?: number;
}

export interface CompactOptions {
  fetch?: typeof globalThis.fetch;
  apiKey?: string;
  signal?: AbortSignal;
  logger?: Logger;
}

/** `http://host:port/v1` + id → `http://host:port/api/sessions/<encoded-id>/compress`. */
export function compressUrl(chatBaseUrl: string, sessionId: string): string {
  const origin = new URL(chatBaseUrl).origin;
  return `${origin}/api/sessions/${encodeURIComponent(sessionId)}/compress`;
}

export async function compressSession(
  config: Pick<EndpointsConfig, "chat_base_url">,
  sessionId: string,
  opts: CompactOptions = {},
): Promise<CompactResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const log = opts.logger ?? createLogger("session_compactor");
  const url = compressUrl(config.chat_base_url, sessionId);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Hermes-Session-Id": sessionId,
  };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      signal: opts.signal,
    });
  } catch (err) {
    log.warn("compress request threw", { sessionId, err: String(err) });
    return { status: "error" };
  }

  if (!res.ok) {
    log.warn("compress non-2xx", { sessionId, status: res.status });
    return { status: "error" };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    log.warn("compress body not JSON", { sessionId, err: String(err) });
    return { status: "error" };
  }
  const body = parsed as Partial<SessionCompressionResponse> | null;

  if (body?.status === "compressed") {
    const headerId = res.headers.get("X-Hermes-Session-Id") ?? undefined;
    const newId = body.session_id ?? headerId;
    if (!newId) {
      log.warn("compressed without session_id (body+header absent)", { sessionId });
      return { status: "error" };
    }
    return {
      status: "compressed",
      session_id: newId,
      before_tokens: body.before_tokens,
      after_tokens: body.after_tokens,
      removed: body.removed,
    };
  }

  if (body?.status === "skipped") {
    return { status: "skipped", session_id: body.session_id ?? sessionId };
  }

  log.warn("compress unexpected status", { sessionId, status: body?.status });
  return { status: "error" };
}

export interface SessionCompactor {
  compress(sessionId: string, signal?: AbortSignal): Promise<CompactResult>;
}

export interface SessionCompactorOptions {
  config: Pick<EndpointsConfig, "chat_base_url">;
  getFetch?: () => typeof globalThis.fetch | undefined;
  getApiKey?: () => string | undefined;
  logger?: Logger;
}

/**
 * Thin factory that binds config + lazy fetch/apiKey resolution so the dispatcher can call
 * `compress(sessionId, signal)` without threading transport details on every call.
 */
export function createSessionCompactor(opts: SessionCompactorOptions): SessionCompactor {
  const log = opts.logger ?? createLogger("session_compactor");
  return {
    compress(sessionId: string, signal?: AbortSignal): Promise<CompactResult> {
      return compressSession(opts.config, sessionId, {
        fetch: opts.getFetch?.(),
        apiKey: opts.getApiKey?.(),
        signal,
        logger: log,
      });
    },
  };
}
