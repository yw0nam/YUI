/**
 * Mock driver — replays all surface states from seed data.
 *
 * Real data (chat-client SSE: express function_call + output_text stream, tts-pipeline)
 * will replace this driver in follow-up work by calling the same Surfaces API. No brain here —
 * script only mimics backend responses (firing ≠ judgment).
 *
 * Call steps directly from screenshot verification loop via dev handle (__yuiDemo).
 */

import type { Surfaces } from "./surfaces";

/** Split utterances into tokens (words + spaces) — mimics output_text.delta stream. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MockDriver {
  /** Reply to input submission in one turn: (tool) → speech stream → settle → fade. */
  reply(userText: string): Promise<void>;
  /** Proactive speech (no input) — demonstrates backend-initiated speech path. */
  proactive(line?: string): Promise<void>;
  /** Play back speech stream only (no tool). */
  speak(line: string): Promise<void>;
  /** In-flight playback cancellation flag. */
  cancel(): void;
}

interface MockOptions {
  /** Delay between tokens (ms). Default 45. */
  tokenDelayMs?: number;
  /** Tool-status duration (ms). Default 1300. */
  toolMs?: number;
}

/** Guess if/which tool is needed from userText — actually observes backend function_call. */
function inferTool(userText: string): string | null {
  const t = userText.toLowerCase();
  if (/검색|찾아|search|뭐야|누구|언제|어디/.test(t)) return "web_search";
  if (/실행|터미널|명령|run|build|테스트/.test(t)) return "terminal";
  if (/열어|사이트|페이지|browse|링크/.test(t)) return "browser";
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
  let token = 0; // Cancellation generation

  function cancel(): void {
    token += 1;
  }

  async function streamLine(line: string, gen: number): Promise<void> {
    surfaces.beginSpeech();
    for (const tok of tokenize(line)) {
      if (gen !== token) return; // Canceled
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

    const toolId = inferTool(userText);
    if (toolId) {
      surfaces.showTool(toolId);
      await sleep(toolMs);
      if (gen !== token) return;
      surfaces.finishTool();
    }

    const line = CANNED_REPLIES[Math.abs(hash(userText)) % CANNED_REPLIES.length];
    await streamLine(line, gen);
  }

  async function proactive(line: string = CANNED_PROACTIVE): Promise<void> {
    cancel();
    const gen = token;
    await streamLine(line, gen);
  }

  return { reply, proactive, speak, cancel };
}

/** Small hash for deterministic canned-response selection (avoids Math.random — reproducible). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h | 0;
}
