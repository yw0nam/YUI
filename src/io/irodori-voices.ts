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

/** 상대 vite 경로("/references/…")는 base 없는 URL이라 Tauri fetchCORS가 거부한다 — 현재 origin 기준 절대화. base 없는(node 테스트) 환경은 원본 유지. */
function toAbsoluteRef(refUrl: string): string {
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  if (!base) return refUrl;
  try {
    return new URL(refUrl, base).href;
  } catch {
    return refUrl;
  }
}

/** 서버 측 voice 삭제(재시작·DELETE)로 422가 나면 메모를 비워 재등록을 허용한다. */
export function evictRegistration(baseUrl: string, id: string): void {
  inflight.delete(`${baseUrl}::${id}`);
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

  const ref = toAbsoluteRef(opts.refUrl);
  const refRes = await fetchImpl(ref);
  if (!refRes.ok) {
    throw new Error(`irodori reference fetch failed (HTTP ${refRes.status}) ${ref}`);
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

export interface UpdateVoiceOptions {
  baseUrl: string;
  id: string;
  refUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

/**
 * 명시적 force-refresh: 기존 voice의 reference latent를 새 클립으로 갱신한다.
 * ensureRegistered와 달리 멱등하지 않다 — GET-check·memoize 없이 항상 ref를 fetch해 PUT한다.
 */
export async function updateVoice(opts: UpdateVoiceOptions): Promise<void> {
  const log = opts.logger ?? createLogger("irodori-voices");
  if (!opts.refUrl) {
    throw new Error("updateVoice requires a reference clip");
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const ref = toAbsoluteRef(opts.refUrl);
  const refRes = await fetchImpl(ref);
  if (!refRes.ok) {
    throw new Error(`irodori reference fetch failed (HTTP ${refRes.status}) ${ref}`);
  }
  const blob = await refRes.blob();

  const form = new FormData();
  form.append("reference_audio", blob, `${opts.id}.mp3`);
  form.append("voice_id", opts.id);

  const putRes = await fetchImpl(`${opts.baseUrl}/voices`, { method: "PUT", body: form });
  if (!putRes.ok) {
    throw new Error(`irodori voice update failed (HTTP ${putRes.status}) ${opts.id}`);
  }
  log.info("voice updated", { id: opts.id });
}

export function ensureRegistered(opts: EnsureRegisteredOptions): Promise<void> {
  const log = opts.logger ?? createLogger("irodori-voices");

  // refUrl 없는 화자는 등록할 클립이 없다 — fetch/POST 없이 no-op, 캐시도 남기지 않는다(나중에 실 refUrl이 오면 등록).
  if (!opts.refUrl) {
    log.debug("voice register skipped", { id: opts.id, skipped: "empty ref_url" });
    return Promise.resolve();
  }

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
