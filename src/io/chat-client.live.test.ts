/**
 * chat-client.live.test.ts — 실 Hermes(:8643)에 streamChat 어댑터를 SecretProvider 경로로 돌리는
 * 통합 테스트. CI 미실행(네트워크/백엔드 의존) — `YUI_LIVE=1`일 때만.
 *
 * 실행:
 *   YUI_LIVE=1 YUI_CHAT_KEY=<API_SERVER_KEY> pnpm exec vitest run src/io/chat-client.live.test.ts
 *
 * 무엇을 증명하나: config의 SecretProvider에서 해소한 키를 streamChat({ apiKey })로 넘기면
 * 키 강제 백엔드에 인증돼 스트리밍 응답이 ChatStreamEvent로 매핑된다 — express 미등록이라
 * speech_delta/done/completed만 온다(정상).
 */
import { describe, expect, it } from "vitest";
import { CHAT_API_KEY_SECRET, plainSecretProvider } from "../config";
import type { EndpointsConfig } from "../contract";
import { type ChatStreamEvent, streamChat } from "./chat-client";

const LIVE = process.env.YUI_LIVE === "1";

// 실 endpoints (configs/endpoints.json과 동일). SDK가 baseURL 뒤 /responses를 append → .../v1.
const endpoints: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

describe.skipIf(!LIVE)("streamChat — LIVE Hermes (SecretProvider 경로)", () => {
  it("SecretProvider 키 → streamChat → 스트리밍 응답을 ChatStreamEvent로 매핑한다", async () => {
    // dev SecretProvider: 실제 앱은 keychain 구현으로 교체. 여기선 env에서 주입.
    const secrets = plainSecretProvider({
      [CHAT_API_KEY_SECRET]: process.env.YUI_CHAT_KEY,
    });
    const apiKey = await secrets.get(CHAT_API_KEY_SECRET);
    expect(apiKey, "YUI_CHAT_KEY env가 있어야 함").toBeTruthy();

    const events: ChatStreamEvent[] = [];
    for await (const ev of streamChat(
      endpoints,
      { input: "한 문장으로 짧게 인사해줘." },
      { apiKey },
    )) {
      events.push(ev);
      if (ev.type === "speech_delta") process.stdout.write(ev.text);
    }
    process.stdout.write("\n");

    const types = events.map((e) => e.type);
    console.log("[live] event types:", types.join(" → "));
    expect(
      events.some((e) => e.type === "error"),
      "error 이벤트가 없어야 함",
    ).toBe(false);

    const completed = events.find((e) => e.type === "completed");
    expect(completed, "completed 이벤트가 와야 함").toBeDefined();
    const envelope = (completed as { envelope: { speech_text: string } }).envelope;
    console.log("[live] speech_text:", JSON.stringify(envelope.speech_text));
    expect(envelope.speech_text.length).toBeGreaterThan(0);
    expect(types).toContain("speech_delta");
    expect(types).toContain("speech_done");
  }, 60_000);

  it("틀린 키 → 401이 무음이 아니라 error 이벤트로 노출된다", async () => {
    const events: ChatStreamEvent[] = [];
    for await (const ev of streamChat(
      endpoints,
      { input: "hi" },
      { apiKey: "definitely-wrong-key" },
    )) {
      events.push(ev);
    }
    // 핵심: 빈 스트림으로 사라지지 않고 error를 낸다.
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "completed")).toBe(false);
  }, 30_000);
});

/** 한 턴을 끝까지 소비해 completed 이벤트(speech_text + responseId)를 돌려준다. */
async function runTurn(
  request: Parameters<typeof streamChat>[1],
  apiKey?: string,
): Promise<{ speech_text: string; responseId: string }> {
  let speech_text = "";
  let responseId = "";
  for await (const ev of streamChat(endpoints, request, { apiKey })) {
    if (ev.type === "error") throw new Error(`stream error: ${ev.message}`);
    if (ev.type === "completed") {
      speech_text = ev.envelope.speech_text;
      responseId = ev.responseId;
    }
  }
  return { speech_text, responseId };
}

describe.skipIf(!LIVE)("streamChat — LIVE previous_response_id 대화 스레딩", () => {
  it("턴1 responseId를 턴2에 넘기면 이름을 회상하고, 안 넘기면 회상하지 못한다", async () => {
    const apiKey = process.env.YUI_CHAT_KEY;
    expect(apiKey, "YUI_CHAT_KEY env가 있어야 함").toBeTruthy();

    const turn1 = await runTurn(
      { input: "내 이름은 철수야. 기억해둬. 한 문장으로 짧게 답해줘." },
      apiKey,
    );
    console.log("[live] turn1 responseId:", turn1.responseId);
    expect(turn1.responseId, "completed가 response.id를 실어야 함").toMatch(/^resp_/);

    // 같은 스레드(previous_response_id 전달) → 이름 회상.
    const withThread = await runTurn(
      { input: "내 이름이 뭐야? 한 단어로 답해줘.", previous_response_id: turn1.responseId },
      apiKey,
    );
    console.log("[live] with-thread:", JSON.stringify(withThread.speech_text));
    expect(withThread.speech_text).toContain("철수");

    // 스레드 미전달(새 대화) → 회상 불가.
    const withoutThread = await runTurn(
      { input: "내 이름이 뭐야? 한 단어로 답해줘." },
      apiKey,
    );
    console.log("[live] without-thread:", JSON.stringify(withoutThread.speech_text));
    expect(withoutThread.speech_text).not.toContain("철수");
  }, 90_000);
});

describe.skipIf(!LIVE)("streamChat — LIVE reasoning.effort 수용", () => {
  it.each(["none", "minimal"] as const)(
    "reasoning_effort '%s' 요청을 error 없이 completed로 수용한다",
    async (effort) => {
      const apiKey = process.env.YUI_CHAT_KEY;
      expect(apiKey, "YUI_CHAT_KEY env가 있어야 함").toBeTruthy();
      const events: ChatStreamEvent[] = [];
      for await (const ev of streamChat(
        endpoints,
        { input: "한 문장으로 짧게 인사해줘.", reasoning_effort: effort },
        { apiKey },
      )) {
        events.push(ev);
      }
      expect(events.some((e) => e.type === "error")).toBe(false);
      expect(events.some((e) => e.type === "completed")).toBe(true);
    },
    60_000,
  );
});
