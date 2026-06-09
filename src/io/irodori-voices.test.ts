/**
 * irodori-voices.test.ts — voice registry idempotent registration (TDD red).
 *
 * 대상: ensureRegistered({ baseUrl, id, refUrl, fetch?, logger? }) => Promise<void>.
 *   GET {baseUrl}/voices → 이미 등록(voice_id 포함)이면 no-op.
 *   미등록이면 fetch(refUrl).blob() → POST {baseUrl}/voices multipart(reference_audio + voice_id).
 *   module-level memoize(`${baseUrl}::${id}`) — 동시/반복 호출 중복 등록 방지, 실패 시 캐시 삭제로 재시도 허용.
 *
 * 테스트는 mock fetch만 사용 — 실제 서버 미접속. 케이스 간 누수 방지를 위해 매번 캐시 리셋.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureRegistered, __resetIrodoriVoiceCache } from "./irodori-voices";

const BASE = "http://localhost:8091";

function voicesResponse(ids: string[]): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ voices: ids.map((voice_id) => ({ voice_id })) }),
  } as unknown as Response;
}

function blobResponse(blob: Blob): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    blob: async () => blob,
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

beforeEach(() => {
  __resetIrodoriVoiceCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureRegistered", () => {
  it("no-ops (only GET, no POST) when the id is already registered", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
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
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("http://localhost:8091/voices");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("fetches refUrl + POSTs multipart when the id is missing", async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "/references/ナツメ/merged_audio.mp3") return blobResponse(audio);
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

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const init = postCall![1] as RequestInit;
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("voice_id")).toBe("ナツメ");
    const ref = body.get("reference_audio");
    expect(ref).toBeInstanceOf(Blob);
  });

  it("memoizes — a second call after success makes no new POST", async () => {
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "/references/x.mp3") return blobResponse(audio);
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
    const postCount = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ).length;
    expect(postCount).toBe(1);
  });

  it("deduplicates concurrent calls into a single registration", async () => {
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "/references/x.mp3") return blobResponse(audio);
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

    const postCount = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ).length;
    expect(postCount).toBe(1);
  });

  it("retries after a failure (cache cleared so a later call re-attempts)", async () => {
    let getCalls = 0;
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        getCalls += 1;
        if (getCalls === 1) {
          return { ok: false, status: 503, headers: new Headers() } as unknown as Response;
        }
        return voicesResponse(["other"]);
      }
      if (url === "/references/x.mp3") return blobResponse(audio);
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
    const postCount = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ).length;
    expect(postCount).toBe(1);
  });

  it("throws a clear message when POST /voices is non-2xx", async () => {
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "/references/x.mp3") return blobResponse(audio);
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
    const fetchMock = vi.fn(async () => {
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

  it("does not memoize the empty-refUrl skip — a later real refUrl still registers", async () => {
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === "/references/natsume.wav") return blobResponse(audio);
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
    const postCount = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ).length;
    expect(postCount).toBe(1);
  });

  it("absolutizes a relative refUrl against window origin before fetching", async () => {
    vi.stubGlobal("location", { href: "http://127.0.0.1:1420/" });
    const expectedRef = new URL("/references/あやせ/merged_audio.mp3", "http://127.0.0.1:1420/").href;
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8091/voices" && (init?.method ?? "GET") === "GET") {
        return voicesResponse(["other"]);
      }
      if (url === expectedRef) return blobResponse(audio);
      if (url === "http://localhost:8091/voices" && init?.method === "POST") {
        return createdResponse("あやせ");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await ensureRegistered({
      baseUrl: BASE,
      id: "あやせ",
      refUrl: "/references/あやせ/merged_audio.mp3",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const refCall = fetchMock.mock.calls.find((c) => String(c[0]) === expectedRef);
    expect(refCall).toBeDefined();
  });
});
