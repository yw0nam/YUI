/**
 * 목업 드라이버 — 시드 데이터로 세 surface의 모든 상태를 재생한다.
 *
 * 실제 데이터(chat-client SSE: express function_call + output_text 스트림, tts-pipeline)는
 * 후속 작업에서 같은 Surfaces API를 호출해 이 드라이버를 대체한다. 여기엔 brain이 없다 —
 * 스크립트가 백엔드 응답을 *흉내*낼 뿐(firing ≠ judgment).
 *
 * dev 핸들(__yuiDemo)로 스크린샷 검증 루프에서 단계를 직접 호출할 수 있다.
 */

import type { Surfaces } from "./surfaces";

/** 발화를 토큰(어절+공백)으로 쪼갠다 — output_text.delta 스트림 흉내. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface MockDriver {
  /** 입력 제출에 대한 응답 1턴 재생: (tool) → 발화 스트림 → settle → fade. */
  reply(userText: string): Promise<void>;
  /** 선제 발화(입력 없이) — backend-initiated 발화 경로 시연. */
  proactive(line?: string): Promise<void>;
  /** 발화 스트림만 재생(도구 없음). */
  speak(line: string): Promise<void>;
  /** 진행 중 재생 취소 플래그. */
  cancel(): void;
}

interface MockOptions {
  /** 토큰 간 간격(ms). 기본 45. */
  tokenDelayMs?: number;
  /** tool-status 지속(ms). 기본 1300. */
  toolMs?: number;
}

/** userText로부터 도구가 필요한지/어떤 라벨인지 흉내 — 실제론 백엔드 function_call 관찰. */
function inferTool(userText: string): string | null {
  const t = userText.toLowerCase();
  if (/검색|찾아|search|뭐야|누구|언제|어디/.test(t)) return "검색 중…";
  if (/실행|터미널|명령|run|build|테스트/.test(t)) return "터미널 실행 중…";
  if (/열어|사이트|페이지|browse|링크/.test(t)) return "브라우저 보는 중…";
  return null;
}

const CANNED_REPLIES = [
  "응, 듣고 있어. 그거 지금 같이 볼까?",
  "방금 찾아봤어 — 핵심만 추리면 이렇게 돼.",
  "음, 그건 두 가지로 나눠서 보면 깔끔해질 것 같아.",
];

const CANNED_PROACTIVE = "오래 앉아 있었네. 잠깐 스트레칭 한 번 어때?";

export function createMockDriver(
  surfaces: Surfaces,
  { tokenDelayMs = 45, toolMs = 1300 }: MockOptions = {},
): MockDriver {
  let token = 0; // 취소 세대

  function cancel(): void {
    token += 1;
  }

  async function streamLine(line: string, gen: number): Promise<void> {
    surfaces.beginSpeech();
    for (const tok of tokenize(line)) {
      if (gen !== token) return; // 취소됨
      surfaces.pushSpeech(tok);
      await sleep(tokenDelayMs);
    }
    if (gen !== token) return;
    surfaces.endSpeech();
  }

  async function speak(line: string): Promise<void> {
    cancel();
    const gen = token;
    await streamLine(line, gen);
  }

  async function reply(userText: string): Promise<void> {
    cancel();
    const gen = token;

    const toolLabel = inferTool(userText);
    if (toolLabel) {
      surfaces.showTool(toolLabel);
      await sleep(toolMs);
      if (gen !== token) return;
      surfaces.hideTool();
    }

    const line =
      CANNED_REPLIES[Math.abs(hash(userText)) % CANNED_REPLIES.length];
    await streamLine(line, gen);
  }

  async function proactive(line: string = CANNED_PROACTIVE): Promise<void> {
    cancel();
    const gen = token;
    await streamLine(line, gen);
  }

  return { reply, proactive, speak, cancel };
}

/** 결정적 캔드 응답 선택용 작은 해시 (Math.random 회피 — 재현 가능). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h | 0;
}
