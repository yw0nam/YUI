/**
 * tts-voices.test.ts — the OpenAI-compatible voices API client.
 *
 * listVoices: GET {tts_base_url}/v1/audio/voices → data[].id. Fail-soft ([] + warn) so a down
 * server never breaks boot. Ids are opaque strings — non-ASCII must survive untouched.
 * upsertVoice: multipart POST /v1/audio/voices, falling back to PUT /v1/audio/voices/{id} on 409.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchReferenceClip } = vi.hoisted(() => ({
  fetchReferenceClip: vi.fn<(refUrl: string, opts?: unknown) => Promise<Blob>>(),
}));
vi.mock("./reference-clip", () => ({ fetchReferenceClip }));

import { deleteVoice, listVoices, upsertVoice } from "./tts-voices";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "http://localhost:8092";
const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
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
  noopLog.warn.mockClear();
  fetchReferenceClip.mockReset().mockResolvedValue(new Blob(["clip"]));
});

describe("listVoices", () => {
  it("GETs {baseUrl}/v1/audio/voices and returns data[].id", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      jsonResponse({
        object: "list",
        data: [{ id: "ナツメ" }, { id: "ムラサメ" }, { id: "none" }],
      }),
    );

    const ids = await listVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8092/v1/audio/voices");
    expect(ids).toEqual(["ナツメ", "ムラサメ", "none"]);
  });

  it("drops non-string and empty ids without touching the rest", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      jsonResponse({ data: [{ id: "ナツメ" }, { id: 7 }, {}, { id: "" }, { id: "レナ" }] }),
    );

    const ids = await listVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(ids).toEqual(["ナツメ", "レナ"]);
  });

  it("sends Authorization: Bearer when a key is configured", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ data: [] }));

    await listVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "sk-tts",
      logger: noopLog,
    });

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-tts");
  });

  it("omits Authorization when no key is configured", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ data: [] }));

    await listVoices({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "  ",
      logger: noopLog,
    });

    const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect("Authorization" in headers).toBe(false);
  });

  it("resolves to [] and warns on a non-2xx response", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(500));

    await expect(
      listVoices({
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).resolves.toEqual([]);
    expect(noopLog.warn).toHaveBeenCalledOnce();
  });

  it("resolves to [] and warns when the request throws", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => {
      throw new Error("connection refused");
    });

    await expect(
      listVoices({
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).resolves.toEqual([]);
    expect(noopLog.warn).toHaveBeenCalledOnce();
  });

  it("resolves to [] when the body carries no data array", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ object: "list" }));

    await expect(
      listVoices({
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).resolves.toEqual([]);
  });
});

describe("upsertVoice", () => {
  const REF_URL = "asset://localhost/app-data/references/myvoice/clip.wav";

  it("POSTs the clip as multipart file + voice_id", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: true, status: 201 }) as unknown as Response,
    );

    await upsertVoice({
      baseUrl: BASE_URL,
      id: "myvoice",
      refUrl: REF_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchReferenceClip).toHaveBeenCalledWith(REF_URL, expect.anything());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8092/v1/audio/voices");
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form.get("voice_id")).toBe("myvoice");
    expect((form.get("file") as File).name).toBe("myvoice.wav");
  });

  // The server validates the uploaded filename's extension, so it must follow the imported clip.
  it("derives the upload filename extension from the reference clip", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: true, status: 201 }) as unknown as Response,
    );

    await upsertVoice({
      baseUrl: BASE_URL,
      id: "myvoice",
      refUrl: "asset://localhost/app-data/references/myvoice/clip.flac",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect((form.get("file") as File).name).toBe("myvoice.flac");
  });

  it("falls back to PUT /v1/audio/voices/{id} when the POST reports 409", async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(errorResponse(409, { error: { message: "voice exists" } }))
      .mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await upsertVoice({
      baseUrl: BASE_URL,
      id: "ナツメ",
      refUrl: REF_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`http://localhost:8092/v1/audio/voices/${encodeURIComponent("ナツメ")}`);
    expect(init?.method).toBe("PUT");
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("throws with the server's error message when the POST fails for another reason", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      errorResponse(415, { error: { message: "unsupported audio type" } }),
    );

    await expect(
      upsertVoice({
        baseUrl: BASE_URL,
        id: "myvoice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/415.*unsupported audio type/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws when the PUT fallback also fails", async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(errorResponse(409))
      .mockResolvedValueOnce(errorResponse(404, { error: { message: "voice not found" } }));

    await expect(
      upsertVoice({
        baseUrl: BASE_URL,
        id: "myvoice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/404.*voice not found/);
  });

  it("throws with the status alone when the error body is not JSON", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => errorResponse(500));

    await expect(
      upsertVoice({
        baseUrl: BASE_URL,
        id: "myvoice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/500/);
  });

  it("sends Authorization: Bearer on both the POST and the PUT fallback", async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(errorResponse(409))
      .mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await upsertVoice({
      baseUrl: BASE_URL,
      id: "myvoice",
      refUrl: REF_URL,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "sk-tts",
    });

    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-tts");
    }
  });

  it("rejects a voice with no reference clip before touching the network", async () => {
    const fetchMock = vi.fn<FetchFn>();

    await expect(
      upsertVoice({
        baseUrl: BASE_URL,
        id: "myvoice",
        refUrl: "",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates a reference-clip read failure", async () => {
    fetchReferenceClip.mockRejectedValue(new Error("reference clip fetch failed (HTTP 404)"));
    const fetchMock = vi.fn<FetchFn>();

    await expect(
      upsertVoice({
        baseUrl: BASE_URL,
        id: "myvoice",
        refUrl: REF_URL,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/reference clip fetch failed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleteVoice", () => {
  it("DELETEs the percent-encoded voice id", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    );

    await deleteVoice({
      baseUrl: BASE_URL,
      id: "voice / ナツメ",
      fetch: fetchMock as unknown as typeof fetch,
      logger: noopLog,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8092/v1/audio/voices/${encodeURIComponent("voice / ナツメ")}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends the Bearer header when configured and omits it otherwise", async () => {
    const fetchMock = vi.fn<FetchFn>(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    );

    await deleteVoice({
      baseUrl: BASE_URL,
      id: "with-key",
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "sk-tts",
      logger: noopLog,
    });
    await deleteVoice({
      baseUrl: BASE_URL,
      id: "without-key",
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "  ",
      logger: noopLog,
    });

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer sk-tts" });
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({});
  });

  it("resolves when the voice is already absent", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      errorResponse(404, { error: { message: "Voice was not found." } }),
    );

    await expect(
      deleteVoice({
        baseUrl: BASE_URL,
        id: "missing",
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws with the server error message on another failure", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      errorResponse(500, { error: { message: "database unavailable" } }),
    );

    await expect(
      deleteVoice({
        baseUrl: BASE_URL,
        id: "myvoice",
        fetch: fetchMock as unknown as typeof fetch,
        logger: noopLog,
      }),
    ).rejects.toThrow("TTS voice delete failed (HTTP 500): database unavailable");
  });
});
