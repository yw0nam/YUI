/** irodori_TTS voice registry — synth 전에 voice id 존재를 멱등하게 보장한다. */

import { createLogger, type Logger } from "../logger";

export interface EnsureRegisteredOptions {
  baseUrl: string;
  id: string;
  /** vite 서빙 경로(예: "/references/ナツメ/merged_audio.mp3"). */
  refUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

// 동시/반복 호출이 중복 등록하지 않도록 in-flight/완료 약속을 캐시. 실패 시 항목 삭제로 재시도 허용.
const inflight = new Map<string, Promise<void>>();

/** test-only: 케이스 간 캐시 누수 방지. */
export function __resetIrodoriVoiceCache(): void {
  inflight.clear();
}

async function register(opts: EnsureRegisteredOptions, log: Logger): Promise<void> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const voicesUrl = `${opts.baseUrl}/voices`;

  const listRes = await fetchImpl(voicesUrl);
  if (!listRes.ok) {
    throw new Error(`irodori voices list failed (HTTP ${listRes.status})`);
  }
  const list = (await listRes.json()) as { voices?: Array<{ voice_id?: string }> };
  const registered = (list.voices ?? []).some((v) => v.voice_id === opts.id);
  if (registered) {
    log.debug("voice already registered", { id: opts.id });
    return;
  }

  const refRes = await fetchImpl(opts.refUrl);
  if (!refRes.ok) {
    throw new Error(`irodori reference fetch failed (HTTP ${refRes.status}) ${opts.refUrl}`);
  }
  const blob = await refRes.blob();

  const form = new FormData();
  form.append("reference_audio", blob, `${opts.id}.mp3`);
  form.append("voice_id", opts.id);

  const postRes = await fetchImpl(voicesUrl, { method: "POST", body: form });
  if (!postRes.ok) {
    throw new Error(`irodori voice register failed (HTTP ${postRes.status}) ${opts.id}`);
  }
  log.info("voice registered", { id: opts.id });
}

export function ensureRegistered(opts: EnsureRegisteredOptions): Promise<void> {
  const log = opts.logger ?? createLogger("irodori-voices");
  const key = `${opts.baseUrl}::${opts.id}`;

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = register(opts, log).catch((err: unknown) => {
    inflight.delete(key);
    throw err;
  });
  inflight.set(key, task);
  return task;
}
