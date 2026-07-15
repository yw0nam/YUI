/** irodori_TTS voice registry — idempotently ensures a voice id exists before synth. */

import { createLogger, type Logger } from "../logger";
import { resolveAssetUrl } from "./asset-url";
import { isTauri } from "./tauri-env";

/** Converts a ref_url into a fetchable URL. dev/browser = absolutized against origin, Tauri = bundle resource URL. */
export type RefUrlResolver = (refUrl: string) => Promise<string>;

export interface EnsureRegisteredOptions {
  baseUrl: string;
  id: string;
  /** vite serving path (e.g. "/references/ナツメ/merged_audio.mp3"). */
  refUrl: string;
  fetch?: typeof fetch;
  /** ref_url resolver (injectable). Defaults to resolveRefUrl (dev origin absolutization / Tauri bundle). */
  resolveRef?: RefUrlResolver;
  logger?: Logger;
}

// Cache in-flight/settled promises so concurrent/repeat calls don't register twice. On failure, delete the entry to allow retry.
const inflight = new Map<string, Promise<void>>();

/** test-only: prevents cache leakage between cases. */
export function __resetIrodoriVoiceCache(): void {
  inflight.clear();
}

/**
 * Converts a ref_url into a fetchable URL.
 * Tauri packaging uses a bundle-resource absolute URL (resolveAssetUrl). dev/browser absolutizes against origin
 * (a relative vite path is a base-less URL that Tauri fetchCORS rejects). Base-less environments (node tests) keep the original.
 */
async function resolveRefUrl(refUrl: string): Promise<string> {
  if (isTauri()) {
    return resolveAssetUrl(refUrl);
  }
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  if (!base) return refUrl;
  try {
    return new URL(refUrl, base).href;
  } catch {
    return refUrl;
  }
}

/** When server-side voice deletion (restart/DELETE) causes a 422, clear the memo to allow re-registration. */
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
    log.debug("voice_already_registered", { id: opts.id });
    return;
  }

  const ref = await (opts.resolveRef ?? resolveRefUrl)(opts.refUrl);
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
  log.info("voice_registered", { id: opts.id });
}

export interface UpdateVoiceOptions {
  baseUrl: string;
  id: string;
  refUrl: string;
  fetch?: typeof fetch;
  /** ref_url resolver (injectable). Defaults to resolveRefUrl. */
  resolveRef?: RefUrlResolver;
  logger?: Logger;
}

/**
 * Explicit force-refresh: updates an existing voice's reference latent with a new clip.
 * Unlike ensureRegistered, not idempotent — always fetches the ref and PUTs, without GET-check or memoize.
 */
export async function updateVoice(opts: UpdateVoiceOptions): Promise<void> {
  const log = opts.logger ?? createLogger("irodori-voices");
  if (!opts.refUrl) {
    throw new Error("updateVoice requires a reference clip");
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const ref = await (opts.resolveRef ?? resolveRefUrl)(opts.refUrl);
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
  log.info("voice_updated", { id: opts.id });
}

export function ensureRegistered(opts: EnsureRegisteredOptions): Promise<void> {
  const log = opts.logger ?? createLogger("irodori-voices");

  // A voice with no refUrl has no clip to register — no-op without fetch/POST, and leave no cache entry (register later when a real refUrl arrives).
  if (!opts.refUrl) {
    log.debug("voice_register_skipped", { id: opts.id, reason: "empty_ref_url" });
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
