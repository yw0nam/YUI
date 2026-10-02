/**
 * fish-voices.test.ts — the Fish Audio /model API client.
 *
 * listFishVoices: GET {baseUrl}/model?self=true&page_size=100&page_number=<n> → items[].{_id,title}
 * across pages (has_more, falling back to total). Fail-soft like the OpenAI-shaped list: a failed
 * fetch resolves null + warn.
 * upsertFishVoice: multipart POST /model (type=tts, title, train_mode=fast, voices) → the returned
 * _id; a non-2xx body's message/detail rides the thrown error.
 * deleteFishVoice: DELETE /model/{_id}.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchReferenceClip } = vi.hoisted(() => ({
  fetchReferenceClip: vi.fn<(refUrl: string, opts?: unknown) => Promise<Blob>>(),
}));
vi.mock("./reference-clip", () => ({ fetchReferenceClip }));

import { deleteFishVoice, listFishVoices, upsertFishVoice } from "./fish-voices";
import { VOICES_REQUEST_TIMEOUT_MS } from "./tts-voices";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.fish.audio";
const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function errorResponse(status: number, body?: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
  } as unknown as Response;
}

beforeEach(() => {
  noopLog.info.mockClear();
  noopLog.warn.mockClear();
  fetchReferenceClip.mockReset().mockResolvedValue(new Blob(["clip"]));
});

describe("listFishVoices", () => {
  it("GETs page 1 with self=true and maps _id/title", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      jsonResponse({ total: 2, items: [{ _id: "m1", title: "ナツメ" }, { _id: "m2" }] }),
    );

    const voices = await listFishVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/model?self=true&page_size=100&page_number=1`,
    );
    expect(voices).toEqual([{ id: "m1", label: "ナツメ" }, { id: "m2" }]);
  });

  it("sends Authorization: Bearer when a key is configured and omits it otherwise", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ items: [] }));

    await listFishVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "fish-key",
      logger: noopLog,
    });
    await listFishVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "  ",
      logger: noopLog,
    });

    const withKey = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const withoutKey = (fetchMock.mock.calls[1][1]?.headers ?? {}) as Record<string, string>;
    expect(withKey.Authorization).toBe("Bearer fish-key");
    expect("Authorization" in withoutKey).toBe(false);
  });

  it("follows has_more onto the next pages and stops when it ends", async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        jsonResponse({ total: 3, items: [{ _id: "a", title: "A" }], has_more: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ total: 3, items: [{ _id: "b", title: "B" }], has_more: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ total: 3, items: [{ _id: "c", title: "C" }], has_more: false }),
      );

    const voices = await listFishVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(voices).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BASE_URL}/model?self=true&page_size=100&page_number=1`,
      `${BASE_URL}/model?self=true&page_size=100&page_number=2`,
      `${BASE_URL}/model?self=true&page_size=100&page_number=3`,
    ]);
  });

  it("stops on total when has_more is absent", async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        jsonResponse({
          total: 3,
          items: [
            { _id: "a", title: "A" },
            { _id: "b", title: "B" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ total: 3, items: [{ _id: "c", title: "C" }] }));

    const voices = await listFishVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(voices).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("trusts a boolean has_more over total", async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        jsonResponse({ total: 5, items: [{ _id: "a", title: "A" }], has_more: false }),
      );

    const voices = await listFishVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(voices).toEqual([{ id: "a", label: "A" }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("resolves to null and warns on a non-2xx response", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(401));

    await expect(
      listFishVoices({
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).resolves.toBeNull();
    expect(noopLog.warn).toHaveBeenCalledOnce();
  });

  it("resolves to null and warns when the request throws", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => {
      throw new Error("connection refused");
    });

    await expect(
      listFishVoices({
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).resolves.toBeNull();
    expect(noopLog.warn).toHaveBeenCalledOnce();
  });

  it("resolves to null and warns with the timeout when the body never settles", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<FetchFn>(
        async () =>
          ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as unknown as Response,
      );

      const pending = listFishVoices({
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      });
      await vi.advanceTimersByTimeAsync(VOICES_REQUEST_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBeNull();
      expect(noopLog.warn).toHaveBeenCalledWith("voice_list_failed", {
        error: expect.stringContaining("voice list timed out"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("upsertFishVoice", () => {
  const REF_URL = "asset://localhost/app-data/references/myvoice/clip.wav";

  it("POSTs the clip as multipart type/title/train_mode/voices and resolves the returned _id", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ _id: "model_9" }, 201));

    const id = await upsertFishVoice({
      baseUrl: BASE_URL,
      name: "My Voice",
      refUrl: REF_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(id).toBe("model_9");
    expect(fetchReferenceClip).toHaveBeenCalledWith(REF_URL, expect.anything());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/model`);
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form.get("type")).toBe("tts");
    expect(form.get("title")).toBe("My Voice");
    expect(form.get("train_mode")).toBe("fast");
    expect(form.get("voices")).toBeInstanceOf(File);
  });

  it("falls back to the id for the title when no name is given", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ _id: "model_9" }, 201));

    await upsertFishVoice({
      baseUrl: BASE_URL,
      id: "myvoice",
      refUrl: REF_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("title")).toBe("myvoice");
  });

  it("sends Authorization: Bearer when a key is configured", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ _id: "model_9" }, 201));

    await upsertFishVoice({
      baseUrl: BASE_URL,
      name: "My Voice",
      refUrl: REF_URL,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "fish-key",
      logger: noopLog,
    });

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fish-key");
  });

  it("throws with the server's message when the POST fails with {message}", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(400, { message: "invalid audio" }));

    await expect(
      upsertFishVoice({
        baseUrl: BASE_URL,
        name: "My Voice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).rejects.toThrow(/400.*invalid audio/);
  });

  it("throws with the server's detail when the body carries {detail}", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(422, { detail: "bad request" }));

    await expect(
      upsertFishVoice({
        baseUrl: BASE_URL,
        name: "My Voice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).rejects.toThrow(/422.*bad request/);
  });

  it("throws with the status alone when the error body is not JSON", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(500));

    await expect(
      upsertFishVoice({
        baseUrl: BASE_URL,
        name: "My Voice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).rejects.toThrow(/500/);
  });

  it("rejects a voice with no reference clip before touching the network", async () => {
    const fetchMock = vi.fn<FetchFn>();

    await expect(
      upsertFishVoice({
        baseUrl: BASE_URL,
        name: "My Voice",
        refUrl: "",
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleteFishVoice", () => {
  it("DELETEs the percent-encoded model id with Bearer", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    );

    await deleteFishVoice({
      baseUrl: BASE_URL,
      id: "model / 9",
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "fish-key",
      logger: noopLog,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/model/${encodeURIComponent("model / 9")}`,
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer fish-key" },
      }),
    );
  });

  it("throws with the server's message on failure", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(403, { message: "not your model" }));

    await expect(
      deleteFishVoice({
        baseUrl: BASE_URL,
        id: "model_9",
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).rejects.toThrow(/403.*not your model/);
  });
});
