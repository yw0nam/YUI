import { afterEach, describe, expect, it, vi } from "vitest";
import { readModels } from "./reader";

const BASE = "https://api.test/v1";
const signal = new AbortController().signal;

// Fake fetch that records each request and replies with a fresh Response; no network.
function recordFetch(makeRes: () => Response) {
  const calls: { url: string; init: RequestInit; headers: Headers }[] = [];
  const fetchImpl: typeof globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init: init ?? {}, headers: new Headers(init?.headers) });
    return Promise.resolve(makeRes());
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("readModels", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("GETs {baseUrl}/models without a double slash and sends the key as a Bearer header", async () => {
    const { fetchImpl, calls } = recordFetch(() => jsonResponse({ data: [] }));

    const result = await readModels({
      baseUrl: `${BASE}/`,
      apiKey: "k-1",
      signal,
      fetch: fetchImpl,
    });

    expect(result).toEqual({ kind: "ok", ids: [] });
    expect(calls[0]?.url).toBe(`${BASE}/models`);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer k-1");
    expect(calls[0]?.init).toMatchObject({ redirect: "error", maxRedirections: 0 });
  });

  it("sends no Authorization header when no key is given", async () => {
    const { fetchImpl, calls } = recordFetch(() => jsonResponse({ data: [] }));

    await readModels({ baseUrl: BASE, signal, fetch: fetchImpl });

    expect(calls[0]?.url).toBe(`${BASE}/models`);
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("keeps first-seen order, deduplicates ids and ignores extra fields", async () => {
    const { fetchImpl } = recordFetch(() =>
      jsonResponse({
        object: "list",
        data: [{ id: "b" }, { id: "a", owned_by: "x" }, { id: "b", extra: 1 }, { id: "c" }],
      }),
    );

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "ok",
      ids: ["b", "a", "c"],
    });
  });

  it("reads data:null with object:list as an empty list", async () => {
    const { fetchImpl } = recordFetch(() => jsonResponse({ object: "list", data: null }));

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "ok",
      ids: [],
    });
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["data missing", JSON.stringify({ object: "list" })],
    ["an element without a string id", JSON.stringify({ data: [{ id: 7 }] })],
  ])("reads a 200 with %s as malformed", async (_name, body) => {
    const { fetchImpl } = recordFetch(() => new Response(body, { status: 200 }));

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "malformed",
    });
  });

  it("reads a rejected fetch as unreachable", async () => {
    const fetchImpl: typeof globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "unreachable",
    });
  });

  it.each([401, 403])("reads HTTP %i as refused", async (status) => {
    const { fetchImpl } = recordFetch(() => new Response("denied", { status }));

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "refused",
    });
  });

  it("reads HTTP 404 as no_list", async () => {
    const { fetchImpl } = recordFetch(() => new Response("missing", { status: 404 }));

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "no_list",
    });
  });

  it("reads any other non-2xx as http with its status", async () => {
    const { fetchImpl } = recordFetch(() => new Response("boom", { status: 500 }));

    await expect(readModels({ baseUrl: BASE, signal, fetch: fetchImpl })).resolves.toEqual({
      kind: "http",
      status: 500,
    });
  });

  it("resolves timeout when the deadline elapses while the body is read", async () => {
    vi.useFakeTimers();
    // A body that neither enqueues nor closes — the budget must span the body read, not just connect.
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.resolve(new Response(new ReadableStream({ start() {} })));

    const promise = readModels({ baseUrl: BASE, signal, fetch: fetchImpl });
    const settled = expect(promise).resolves.toEqual({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });

  it("rejects with the abort error when the caller's signal fires", async () => {
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.resolve(new Response(new ReadableStream({ start() {} })));
    const controller = new AbortController();

    const promise = readModels({ baseUrl: BASE, signal: controller.signal, fetch: fetchImpl });
    const settled = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await settled;
  });
});
