/**
 * session-compactor.test.ts — write-only Hermes session compaction client (TDD red).
 *
 * 대상: compressUrl(chatBaseUrl, sessionId) — 순수 origin 도출 + id 인코딩.
 *   compressSession(config, sessionId, opts?) — best-effort POST, never throws.
 *   body.session_id가 진실의 원천이고 없으면 X-Hermes-Session-Id 헤더로 폴백.
 *   compressed에 둘 다 없으면 error(undefined로 rotate 금지). non-2xx/throw/parse-fail/abort → error.
 *
 * 테스트는 주입한 fake fetch만 사용 — 실제 Hermes 미접속.
 */

import { describe, expect, it, vi } from "vitest";
import type { SessionCompressionResponse } from "../contract";
import type { Logger } from "../logger";
import { compressSession, compressUrl } from "./session-compactor";

type FetchFn = (input: unknown, init?: RequestInit) => Promise<Response>;

const CONFIG = { chat_base_url: "http://localhost:8643/v1" };

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** JSON Response with optional X-Hermes-Session-Id header. */
function jsonResponse(body: unknown, opts: { status?: number; sessionId?: string } = {}): Response {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (opts.sessionId) headers.set("X-Hermes-Session-Id", opts.sessionId);
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const COMPRESSED: SessionCompressionResponse = {
  object: "hermes.session.compression",
  status: "compressed",
  session_id: "sess-new",
  previous_session_id: "sess-old",
  before_messages: 40,
  after_messages: 12,
  before_tokens: 8000,
  after_tokens: 2400,
  removed: 28,
};

const SKIPPED: SessionCompressionResponse = {
  object: "hermes.session.compression",
  status: "skipped",
  session_id: "sess-old",
  reason: "under_threshold",
};

describe("compressUrl", () => {
  it("derives origin from a /v1 base and does not double-append /v1", () => {
    expect(compressUrl("http://localhost:8643/v1", "sess-old")).toBe(
      "http://localhost:8643/api/sessions/sess-old/compress",
    );
  });

  it("encodeURIComponents the session id", () => {
    expect(compressUrl("http://localhost:8643/v1", "a/b c")).toBe(
      "http://localhost:8643/api/sessions/a%2Fb%20c/compress",
    );
  });
});

describe("compressSession — compressed", () => {
  it("returns the NEW session id + token stats from the body", async () => {
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(COMPRESSED));
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      apiKey: "key-123",
      logger: silentLogger(),
    });
    expect(result).toEqual({
      status: "compressed",
      session_id: "sess-new",
      before_tokens: 8000,
      after_tokens: 2400,
      removed: 28,
    });
  });

  it("POSTs to the derived URL with Authorization + X-Hermes-Session-Id + JSON body", async () => {
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(COMPRESSED));
    await compressSession(CONFIG, "sess-old", {
      fetch,
      apiKey: "key-123",
      logger: silentLogger(),
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8643/api/sessions/sess-old/compress");
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-123");
    expect(headers["X-Hermes-Session-Id"]).toBe("sess-old");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(String(init?.body))).toEqual({});
  });

  it("falls back to the response X-Hermes-Session-Id header when body lacks session_id", async () => {
    const bodyNoId = {
      object: "hermes.session.compression",
      status: "compressed",
      previous_session_id: "sess-old",
      before_tokens: 8000,
      after_tokens: 2400,
      removed: 28,
    };
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(bodyNoId, { sessionId: "sess-header" }));
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      logger: silentLogger(),
    });
    expect(result.status).toBe("compressed");
    expect(result.session_id).toBe("sess-header");
  });

  it("returns error when compressed status has neither body nor header id", async () => {
    const bodyNoId = {
      object: "hermes.session.compression",
      status: "compressed",
      previous_session_id: "sess-old",
      before_tokens: 8000,
      after_tokens: 2400,
      removed: 28,
    };
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(bodyNoId));
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "error" });
  });
});

describe("compressSession — skipped", () => {
  it("returns skipped with the body session_id, no throw", async () => {
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(SKIPPED));
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "skipped", session_id: "sess-old" });
  });

  it("falls back to the input session id when skipped body lacks session_id", async () => {
    const fetch = vi.fn<FetchFn>(async () =>
      jsonResponse({ object: "hermes.session.compression", status: "skipped", reason: "x" }),
    );
    const result = await compressSession(CONFIG, "sess-input", {
      fetch,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "skipped", session_id: "sess-input" });
  });
});

describe("compressSession — non-fatal failures", () => {
  it("returns error on 404 (unknown/expired session), no throw, warns", async () => {
    const logger = silentLogger();
    const fetch = vi.fn<FetchFn>(async () => jsonResponse({}, { status: 404 }));
    const result = await compressSession(CONFIG, "sess-old", { fetch, logger });
    expect(result).toEqual({ status: "error" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns error on non-2xx (500), no throw", async () => {
    const fetch = vi.fn<FetchFn>(async () => jsonResponse({}, { status: 500 }));
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when fetch throws (network down), no throw, warns", async () => {
    const logger = silentLogger();
    const fetch = vi.fn<FetchFn>(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await compressSession(CONFIG, "sess-old", { fetch, logger });
    expect(result).toEqual({ status: "error" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns error when the body is not JSON, no throw", async () => {
    const fetch = vi.fn<FetchFn>(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
          text: async () => "garbage",
        }) as unknown as Response,
    );
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "error" });
  });

  it("returns error on an unknown status value", async () => {
    const fetch = vi.fn<FetchFn>(async () =>
      jsonResponse({ object: "hermes.session.compression", status: "weird" }),
    );
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "error" });
  });

  it("returns error gracefully when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<FetchFn>(async (_i: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return jsonResponse(COMPRESSED);
    });
    const result = await compressSession(CONFIG, "sess-old", {
      fetch,
      signal: controller.signal,
      logger: silentLogger(),
    });
    expect(result).toEqual({ status: "error" });
  });

  it("forwards the abort signal to fetch", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(COMPRESSED));
    await compressSession(CONFIG, "sess-old", {
      fetch,
      signal: controller.signal,
      logger: silentLogger(),
    });
    const [, init] = fetch.mock.calls[0];
    expect(init?.signal).toBe(controller.signal);
  });
});

describe("compressSession — auth", () => {
  it("omits the Authorization header when no apiKey is supplied", async () => {
    const fetch = vi.fn<FetchFn>(async () => jsonResponse(COMPRESSED));
    await compressSession(CONFIG, "sess-old", { fetch, logger: silentLogger() });
    const [, init] = fetch.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
