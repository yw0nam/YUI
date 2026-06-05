/**
 * Transport seam: StreamChatOptions.fetch 주입 → OpenAI 생성자 전달 → streamChat 사용까지,
 * 그리고 selectFetch의 환경별 선택(Tauri=injected fetchCORS, dev=undefined).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { EndpointsConfig } from "../contract";
import {
  streamChat,
  selectFetch,
  type ChatStreamEvent,
  type ChatRequest,
  type StreamChatOptions,
} from "./chat-client";

// ── openai SDK mock (same pattern as chat-client.test.ts) ──────────────────
const capturedOpts: any[] = [];
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn((opts: any) => {
    capturedOpts.push(opts);
    return { responses: { create: createMock } };
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  capturedOpts.length = 0;
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function* streamOf(events: any[]): AsyncGenerator<any> {
  for (const ev of events) yield ev;
}

async function collect(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  input: [{ role: "user", content: "hi" }],
  ...over,
});

const completed = (text: string): any => ({
  type: "response.completed",
  response: {
    id: "resp_1",
    status: "completed",
    output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text }] }],
  },
});

// ── transport seam tests ─────────────────────────────────────────────────────

describe("streamChat — fetch injection seam (D-TAURI-FETCH)", () => {
  it("passes injected fetch to the OpenAI constructor when opts.fetch is provided", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));
    const customFetch = vi.fn();
    const opts: StreamChatOptions = { fetch: customFetch as unknown as typeof globalThis.fetch };

    await collect(streamChat(CONFIG, req(), opts));

    expect(capturedOpts.length).toBeGreaterThan(0);
    expect(capturedOpts[0].fetch).toBe(customFetch);
  });

  it("does NOT set fetch on the OpenAI constructor when opts.fetch is undefined (dev path)", async () => {
    createMock.mockResolvedValue(streamOf([completed("")]));

    await collect(streamChat(CONFIG, req(), {}));

    expect(capturedOpts.length).toBeGreaterThan(0);
    // fetch 키 자체가 없거나 undefined — SDK가 글로벌 fetch 사용
    expect(capturedOpts[0].fetch == null).toBe(true);
  });

  it("injected fetch reaches the stream; completed envelope is still produced", async () => {
    createMock.mockResolvedValue(streamOf([completed("hello")]));
    const customFetch = vi.fn();

    const events = await collect(
      streamChat(CONFIG, req(), { fetch: customFetch as unknown as typeof globalThis.fetch }),
    );

    const final = events.find((e) => e.type === "completed");
    expect(final).toBeDefined();
    expect(final!.type === "completed" && final!.envelope.speech_text).toBe("");
  });
});

describe("selectFetch — environment detection", () => {
  it("returns undefined when __TAURI_INTERNALS__ is absent (dev/browser path)", async () => {
    // JSDOM test env has no Tauri — selectFetch should return undefined
    const result = await selectFetch();
    expect(result).toBeUndefined();
  });

  it("returns injected fetchCORS when present in Tauri env", async () => {
    (globalThis as any).__TAURI_INTERNALS__ = {};
    const stub = (() => {}) as unknown as typeof fetch;
    (globalThis as any).fetchCORS = stub;
    try {
      expect(await selectFetch()).toBe(stub);
    } finally {
      delete (globalThis as any).__TAURI_INTERNALS__;
      delete (globalThis as any).fetchCORS;
    }
  });

  it("falls back to undefined in Tauri env when fetchCORS not yet injected", async () => {
    (globalThis as any).__TAURI_INTERNALS__ = {};
    try {
      expect(await selectFetch()).toBeUndefined();
    } finally {
      delete (globalThis as any).__TAURI_INTERNALS__;
    }
  });
});
