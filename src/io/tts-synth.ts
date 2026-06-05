/**
 * tts-synth.ts — per-sentence TTS HTTP 호출 (PRD F4 / contract.md §3 step 5).
 *
 * TTS 서비스는 OpenAI 호환(vLLM serving fishaudio/s2-pro). 엔드포인트:
 *   POST {tts_base_url}/v1/audio/speech
 *   body { input, response_format:"wav", model?, voice?, speed? }
 *   → 200 audio/wav (RIFF WAVE PCM 16-bit mono 44100Hz) / 비2xx면 JSON { error:{message} }.
 *
 * 엔드포인트/모델은 config 소관(하드코딩 금지, PRD F8). fetch는 주입 가능(chat-client와 동일 패턴) —
 * 기본은 globalThis.fetch. emotion_text prefix 부착은 pipeline 책임이며 여기선 input을 그대로 보낸다.
 */

import type { EndpointsConfig } from "../contract";

export interface TtsSynthOptions {
  config: EndpointsConfig;
  /** transport fetch 주입(테스트/Tauri). 미지정 시 globalThis.fetch. */
  fetch?: typeof fetch;
  /** TTS 모델 ID(config). 미지정 시 서비스 default. */
  model?: string;
  /** voice(config). 미지정 시 서비스 default. */
  voice?: string;
  /** 0.25~? 재생 속도(config). 미지정 시 서비스 default. */
  speed?: number;
}

/** prefix가 붙은 한 문장 input → wav ArrayBuffer. */
export type TtsSynth = (input: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

export function createTtsSynth(opts: TtsSynthOptions): TtsSynth {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `${opts.config.tts_base_url}/v1/audio/speech`;

  return async (input, signal) => {
    const body: Record<string, unknown> = { input, response_format: "wav" };
    if (opts.model !== undefined) body.model = opts.model;
    if (opts.voice !== undefined) body.voice = opts.voice;
    if (opts.speed !== undefined) body.speed = opts.speed;

    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j?.error?.message) detail = `: ${j.error.message}`;
      } catch {
        // 비-JSON 에러 바디 — status만으로 메시지 구성.
      }
      throw new Error(`TTS request failed (HTTP ${res.status})${detail}`);
    }

    return res.arrayBuffer();
  };
}
