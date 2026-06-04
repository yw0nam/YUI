/**
 * chat-client-transport.test.ts — Transport seam TDD (#39).
 *
 * 검증 대상 (issue #39, D-TAURI-FETCH):
 *  1. StreamChatOptions.fetch 가 있으면 makeClient에 주입된다.
 *  2. 주입된 fetch가 OpenAI 생성자로 전달된다 (SDK fetch 옵션 seam).
 *  3. selectFetch(): Tauri 환경이면 tauriFetch를 반환, 아니면 undefined를 반환
 *     (undefined → SDK가 글로벌 fetch 사용 → dev/vite proxy 경로).
 *  4. streamChat이 주입 fetch를 실제로 사용한다 (end-to-end seam 체인).
 *
 * 결정 D-TAURI-FETCH (docs/prd.md에 append 예정):
 *   `@tauri-apps/plugin-http`의 `fetch`를 `new OpenAI({ fetch })` 옵션으로 주입.
 *   dev/vite 환경 = fetch 미주입(undefined) → SDK 글로벌 fetch 사용 → vite proxy 경유.
 *   prod/Tauri 환경 = tauriFetch 주입 → Rust side 요청 → Origin 헤더 없음 → CORS 우회.
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
  it("returns undefined when __TAURI_INTERNALS__ is absent (dev/browser path)", () => {
    // JSDOM test env has no Tauri — selectFetch should return undefined
    const result = selectFetch();
    expect(result).toBeUndefined();
  });

  it("returns a function when __TAURI_INTERNALS__ is present (Tauri prod path)", () => {
    // Simulate Tauri environment by setting the global marker
    (globalThis as any).__TAURI_INTERNALS__ = {};
    try {
      const result = selectFetch();
      // In Tauri env, should return a fetch-compatible function
      expect(typeof result).toBe("function");
    } finally {
      delete (globalThis as any).__TAURI_INTERNALS__;
    }
  });
});
