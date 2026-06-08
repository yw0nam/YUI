/**
 * irodori-synth.test.ts — irodori_TTS per-sentence synth (TDD red).
 *
 * 대상: createIrodoriSynth({ baseUrl, referenceId, fetch?, num/cfg/seconds?, logger? })
 *   → (input, signal?) => Promise<ArrayBuffer>.
 * POST {baseUrl}/synthesize, multipart/form-data: text + reference_id + (정의된) tunables.
 * 비2xx → status + detail(문자열 | 배열 msg join) 포함 Error throw. 성공 → response.arrayBuffer().
 *
 * 라이브 8091 계약(프로브 완료) 기준. 테스트는 mock fetch만 사용 — 실제 서버 미접속.
 */

import { describe, it, expect, vi } from "vitest";
import { createIrodoriSynth } from "./irodori-synth";

const BASE = "http://localhost:8091";

function okResponse(buf: ArrayBuffer, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  return {
    ok: true,
    status: 200,
    headers: h,
    arrayBuffer: async () => buf,
  } as unknown as Response;
}

function errResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

describe("createIrodoriSynth", () => {
  it("POSTs multipart to {baseUrl}/synthesize with text + reference_id", async () => {
    const buf = new ArrayBuffer(8);
    const fetchMock = vi.fn(async () => okResponse(buf));
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "ナツメ",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await synth("こんにちは。");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8091/synthesize");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("text")).toBe("こんにちは。");
    expect(body.get("reference_id")).toBe("ナツメ");
    expect(out).toBe(buf);
  });

  it("includes tunables only when defined (as strings)", async () => {
    const fetchMock = vi.fn(async () => okResponse(new ArrayBuffer(4)));
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
      numSteps: 16,
      cfgScaleText: 2.5,
      cfgScaleSpeaker: 1.0,
      seconds: 8,
    });
    await synth("hi");
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("num_steps")).toBe("16");
    expect(body.get("cfg_scale_text")).toBe("2.5");
    expect(body.get("cfg_scale_speaker")).toBe("1");
    expect(body.get("seconds")).toBe("8");
  });

  it("omits tunable fields entirely when not configured", async () => {
    const fetchMock = vi.fn(async () => okResponse(new ArrayBuffer(4)));
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("hi");
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.has("num_steps")).toBe(false);
    expect(body.has("cfg_scale_text")).toBe(false);
    expect(body.has("cfg_scale_speaker")).toBe(false);
    expect(body.has("seconds")).toBe(false);
  });

  it("never sends reference_audio or reference_text from the synth path", async () => {
    const fetchMock = vi.fn(async () => okResponse(new ArrayBuffer(4)));
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("hi");
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.has("reference_audio")).toBe(false);
    expect(body.has("reference_text")).toBe(false);
  });

  it("throws on non-2xx with string detail (422 unknown reference_id)", async () => {
    const fetchMock = vi.fn(async () =>
      errResponse(422, { detail: "unknown reference_id 'nope'" }),
    );
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "nope",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(synth("x")).rejects.toThrow(/422/);
    await expect(synth("x")).rejects.toThrow(/unknown reference_id 'nope'/);
  });

  it("throws on non-2xx with array detail (validation objects)", async () => {
    const fetchMock = vi.fn(async () =>
      errResponse(422, {
        detail: [
          { type: "missing", loc: ["body", "text"], msg: "Field required" },
          { type: "string_type", loc: ["body", "reference_id"], msg: "Input should be a valid string" },
        ],
      }),
    );
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(synth("x")).rejects.toThrow(/422/);
    await expect(synth("x")).rejects.toThrow(/Field required/);
    await expect(synth("x")).rejects.toThrow(/Input should be a valid string/);
  });

  it("throws with status even when error body is not JSON", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => {
        throw new Error("not json");
      },
    }) as unknown as Response);
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(synth("x")).rejects.toThrow(/503/);
  });

  it("returns the response arrayBuffer on success", async () => {
    const buf = new ArrayBuffer(16);
    const fetchMock = vi.fn(async () =>
      okResponse(buf, { "X-RTF": "0.42", "Server-Timing": "total;dur=512" }),
    );
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const out = await synth("hi");
    expect(out).toBe(buf);
  });

  it("passes the AbortSignal through to fetch", async () => {
    const fetchMock = vi.fn(async () => okResponse(new ArrayBuffer(2)));
    const synth = createIrodoriSynth({
      baseUrl: BASE,
      referenceId: "v1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const ac = new AbortController();
    await synth("hi", ac.signal);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(ac.signal);
  });
});
