/**
 * irodori-voices.test.ts — voice registry idempotent registration.
 *
 * Target: ensureRegistered({ baseUrl, id, refUrl, fetch?, logger? }) => Promise<void>.
 *   GET {baseUrl}/voices → if already registered (voice_id present) no-op.
 *   If unregistered: fetch(refUrl).blob() → POST {baseUrl}/voices multipart(reference_audio + voice_id).
 *   Module-level memoize(`${baseUrl}::${id}`) — prevents duplicate registration on concurrent/repeated calls,
 *   allows retry on failure by cache eviction.
 *
 * Tests use mock fetch only — no real server. Reset cache per case to prevent leakage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetIrodoriVoiceCache,
  ensureRegistered,
  evictRegistration,
  listVoices,
  updateVoice,
  voiceRevision,
} from "./irodori-voices";

const referenceClip = vi.hoisted(() => ({
  fetch: vi.fn<(refUrl: string, opts?: { fetch?: typeof fetch }) => Promise<Blob>>(),
}));

vi.mock("./reference-clip", () => ({
  fetchReferenceClip: referenceClip.fetch,
}));

type FetchFn = (input: unknown, init?: RequestInit) => Promise<Response>;

const BASE = "http://localhost:8091";

function voicesResponse(ids: string[]): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ voices: ids.map((voice_id) => ({ voice_id })) }),
  } as unknown as Response;
}

function createdResponse(voice_id: string): Response {
  return {
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => ({ voice_id }),
  } as unknown as Response;
}

function updatedResponse(voice_id: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ voice_id }),
  } as unknown as Response;
}

beforeEach(() => {
  __resetIrodoriVoiceCache();
  referenceClip.fetch.mockReset();
  referenceClip.fetch.mockResolvedValue(
    new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureRegistered", () => {
  it("no-ops (only GET, no POST) when the id is already registered", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/voices")) return voicesResponse(["ナツメ", "other"]);
      throw new Error(`unexpected fetch ${url}`);
    });

    await ensureRegistered({
      baseUrl: BASE,
      id: "ナツメ",
      refUrl: "/references/ナツメ/merged_audio.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchMock.mock.calls[0];
    const url = String(rawUrl);
    expect(url).toBe("http://localhost:8091/voices");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("fetches refUrl + POSTs multipart when the id is missing", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("ナツメ");
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });

    await ensureRegistered({
      baseUrl: BASE,
      id: "ナツメ",
      refUrl: "/references/ナツメ/merged_audio.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall).toBeDefined();
    const init = postCall![1]!;
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("voice_id")).toBe("ナツメ");
    const ref = body.get("reference_audio");
    expect(ref).toBeInstanceOf(Blob);
    expect(referenceClip.fetch).toHaveBeenCalledWith("/references/ナツメ/merged_audio.mp3", {
      fetch: fetchMock,
    });
  });

  it("memoizes — a second call after success makes no new POST", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("x");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const opts = {
      baseUrl: BASE,
      id: "x",
      refUrl: "/references/x.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    };
    await ensureRegistered(opts);
    const afterFirst = fetchMock.mock.calls.length;
    await ensureRegistered(opts);

    // second call resolves from memo cache — no additional fetch at all.
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
    const postCount = fetchMock.mock.calls.filter((c) => c[1]?.method === "POST").length;
    expect(postCount).toBe(1);
  });

  it("deduplicates concurrent calls into a single registration", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("x");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const opts = {
      baseUrl: BASE,
      id: "x",
      refUrl: "/references/x.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    };
    await Promise.all([ensureRegistered(opts), ensureRegistered(opts), ensureRegistered(opts)]);

    const postCount = fetchMock.mock.calls.filter((c) => c[1]?.method === "POST").length;
    expect(postCount).toBe(1);
  });

  it("retries after a failure (cache cleared so a later call re-attempts)", async () => {
    let getCalls = 0;
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        getCalls += 1;
        if (getCalls === 1) {
          return { ok: false, status: 503, headers: new Headers() } as unknown as Response;
        }
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("x");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const opts = {
      baseUrl: BASE,
      id: "x",
      refUrl: "/references/x.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    };
    await expect(ensureRegistered(opts)).rejects.toThrow();
    // cache entry was deleted on failure → retry proceeds and succeeds.
    await expect(ensureRegistered(opts)).resolves.toBeUndefined();
    const postCount = fetchMock.mock.calls.filter((c) => c[1]?.method === "POST").length;
    expect(postCount).toBe(1);
  });

  it("threads the signal into the registration fetch and evicts the memo on abort (a later call is not poisoned)", async () => {
    const controller = new AbortController();
    // Simulates a stuck registration fetch — never settles unless the signal aborts it.
    const fetchMock = vi.fn<FetchFn>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = ensureRegistered({
      baseUrl: BASE,
      id: "x",
      refUrl: "/references/x.mp3",
      fetch: fetchMock as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);

    // A fresh call for the same id is not stuck behind the aborted registration — the memo
    // was evicted on rejection, so this retries from scratch and succeeds.
    const fetchMock2 = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("x");
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await expect(
      ensureRegistered({
        baseUrl: BASE,
        id: "x",
        refUrl: "/references/x.mp3",
        fetch: fetchMock2 as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws a clear message when POST /voices is non-2xx", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return { ok: false, status: 500, headers: new Headers() } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(
      ensureRegistered({
        baseUrl: BASE,
        id: "x",
        refUrl: "/references/x.mp3",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/500/);
  });

  it("skips entirely (no fetch/POST, no throw) when refUrl is empty", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => {
      throw new Error("should not fetch for empty refUrl");
    });

    await expect(
      ensureRegistered({
        baseUrl: BASE,
        id: "natsume",
        refUrl: "",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("evictRegistration drops the memo so a later call re-registers", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("x");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const opts = {
      baseUrl: BASE,
      id: "x",
      refUrl: "/references/x.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    };
    await ensureRegistered(opts);
    evictRegistration(BASE, "x");
    await ensureRegistered(opts);

    const postCount = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ).length;
    expect(postCount).toBe(2);
  });

  it("does not memoize the empty-refUrl skip — a later real refUrl still registers", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("natsume");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    // first call with empty refUrl is a no-op skip…
    await ensureRegistered({
      baseUrl: BASE,
      id: "natsume",
      refUrl: "",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // …a subsequent call with a real refUrl for the SAME id still registers.
    await ensureRegistered({
      baseUrl: BASE,
      id: "natsume",
      refUrl: "/references/natsume.wav",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const postCount = fetchMock.mock.calls.filter((c) => c[1]?.method === "POST").length;
    expect(postCount).toBe(1);
  });
});

describe("updateVoice", () => {
  it("PUTs multipart to /voices/{voice_id} with a percent-encoded non-ASCII id and only reference_audio in the body", async () => {
    const encodedId = encodeURIComponent("ナツメ");
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === `http://localhost:8091/voices/${encodedId}` && init?.method === "PUT") {
        return updatedResponse("ナツメ");
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });

    await updateVoice({
      baseUrl: BASE,
      id: "ナツメ",
      refUrl: "/references/ナツメ/merged_audio.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(String(putCall![0])).toBe(`http://localhost:8091/voices/${encodedId}`);
    const body = putCall![1]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    // voice_id travels in the path for PUT /voices/{voice_id} — the server's Body_upsert_voice schema has no voice_id field.
    expect(body.get("voice_id")).toBeNull();
    const ref = body.get("reference_audio");
    expect(ref).toBeInstanceOf(Blob);
    expect(referenceClip.fetch).toHaveBeenCalledWith("/references/ナツメ/merged_audio.mp3", {
      fetch: fetchMock,
    });
  });

  it("always fetches the ref + PUTs even when the id already exists (no GET check)", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices/x" && init?.method === "PUT") {
        return updatedResponse("x");
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });

    await updateVoice({
      baseUrl: BASE,
      id: "x",
      refUrl: "/references/x.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    });

    // no GET /voices — a refresh is an explicit force-update, not a presence check.
    const getCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/voices") && (c[1]?.method ?? "GET") === "GET",
    );
    expect(getCall).toBeUndefined();
    const putCount = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT").length;
    expect(putCount).toBe(1);
  });

  it("bumps the voice revision so callers can tell the clip behind the id changed", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices/x" && init?.method === "PUT") {
        return updatedResponse("x");
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const update = () =>
      updateVoice({
        baseUrl: BASE,
        id: "x",
        refUrl: "/references/x.mp3",
        fetch: fetchMock as unknown as typeof fetch,
      });

    expect(voiceRevision(BASE, "x")).toBe(0);
    await update();
    expect(voiceRevision(BASE, "x")).toBe(1);
    await update();
    expect(voiceRevision(BASE, "x")).toBe(2);
    // Scoped per baseUrl::id — an unrelated voice is untouched.
    expect(voiceRevision(BASE, "y")).toBe(0);
  });

  it("throws a clear message when PUT /voices/{voice_id} is non-2xx", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices/x" && init?.method === "PUT") {
        return { ok: false, status: 500, headers: new Headers() } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(
      updateVoice({
        baseUrl: BASE,
        id: "x",
        refUrl: "/references/x.mp3",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws (no fetch) when refUrl is empty", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => {
      throw new Error("should not fetch for empty refUrl");
    });

    await expect(
      updateVoice({
        baseUrl: BASE,
        id: "x",
        refUrl: "",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/requires a reference clip/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the ref fetch is non-ok", async () => {
    referenceClip.fetch.mockRejectedValueOnce(
      new Error("reference clip fetch failed (HTTP 404) /references/x.mp3"),
    );
    const fetchMock = vi.fn<FetchFn>();

    await expect(
      updateVoice({
        baseUrl: BASE,
        id: "x",
        refUrl: "/references/x.mp3",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("listVoices", () => {
  it("returns the registered voice ids", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown) => {
      const url = String(input);
      if (url === `${BASE}/voices`) return voicesResponse(["ナツメ", "あやせ"]);
      throw new Error(`unexpected fetch ${url}`);
    });

    const ids = await listVoices({ baseUrl: BASE, fetch: fetchMock as unknown as typeof fetch });

    expect(ids).toEqual(["ナツメ", "あやせ"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/voices`);
  });

  it("drops entries without a usable voice_id", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            voices: [
              { voice_id: "ナツメ" },
              {},
              { voice_id: "" },
              { voice_id: 42 },
              { other: "x" },
            ],
          }),
        }) as unknown as Response,
    );

    const ids = await listVoices({ baseUrl: BASE, fetch: fetchMock as unknown as typeof fetch });

    expect(ids).toEqual(["ナツメ"]);
  });

  it("returns [] and warns on a non-ok response (a down server must not throw into boot)", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: false, status: 503, headers: new Headers() }) as unknown as Response,
    );

    const ids = await listVoices({
      baseUrl: BASE,
      fetch: fetchMock as unknown as typeof fetch,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });

    expect(ids).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns [] and warns on a network error", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<FetchFn>(async () => {
      throw new Error("network down");
    });

    const ids = await listVoices({
      baseUrl: BASE,
      fetch: fetchMock as unknown as typeof fetch,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });

    expect(ids).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("listVoices", () => {
  it("returns the registered voice ids", async () => {
    const fetchMock = vi.fn<FetchFn>(async (input: unknown) => {
      const url = String(input);
      if (url === `${BASE}/voices`) return voicesResponse(["ナツメ", "あやせ"]);
      throw new Error(`unexpected fetch ${url}`);
    });

    const ids = await listVoices({ baseUrl: BASE, fetch: fetchMock as unknown as typeof fetch });

    expect(ids).toEqual(["ナツメ", "あやせ"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/voices`);
  });

  it("drops entries without a usable voice_id", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            voices: [
              { voice_id: "ナツメ" },
              {},
              { voice_id: "" },
              { voice_id: 42 },
              { other: "x" },
            ],
          }),
        }) as unknown as Response,
    );

    const ids = await listVoices({ baseUrl: BASE, fetch: fetchMock as unknown as typeof fetch });

    expect(ids).toEqual(["ナツメ"]);
  });

  it("returns [] and warns on a non-ok response (a down server must not throw into boot)", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: false, status: 503, headers: new Headers() }) as unknown as Response,
    );

    const ids = await listVoices({
      baseUrl: BASE,
      fetch: fetchMock as unknown as typeof fetch,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });

    expect(ids).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns [] and warns on a network error", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<FetchFn>(async () => {
      throw new Error("network down");
    });

    const ids = await listVoices({
      baseUrl: BASE,
      fetch: fetchMock as unknown as typeof fetch,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });

    expect(ids).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
