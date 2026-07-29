/** irodori_TTS voice registry — idempotently ensures a voice id exists before synth. */

import { createLogger, type Logger } from "../logger";
import { resolveAssetUrl } from "./asset-url";
import { isTauri } from "./tauri-env";

/** Converts a ref_url into a fetchable URL. dev/browser = absolutized against origin, Tauri = bundle resource URL. */
type RefUrlResolver = (refUrl: string) => Promise<string>;

interface EnsureRegisteredOptions {
  baseUrl: string;
  id: string;
  /** Empty for a server-listed voice (nothing to register). An asset:// URL for a user-imported clip (e.g. "asset://localhost/app-data/references/myvoice/clip.mp3"). */
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
 * Tauri packaging resolves to a bundle-resource absolute URL (resolveAssetUrl); Tauri dev and browser keep the
 * vite path, which is then absolutized against origin (a base-less URL is rejected by Tauri fetchCORS).
 * Absolute URLs pass through unchanged; base-less environments (node tests) keep the original.
 */
async function resolveRefUrl(refUrl: string): Promise<string> {
  const resolved = isTauri() ? await resolveAssetUrl(refUrl) : refUrl;
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  if (!base) return resolved;
  try {
    return new URL(resolved, base).href;
  } catch {
    return resolved;
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

interface UpdateVoiceOptions {
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

interface ListVoicesOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

/**
 * GETs {baseUrl}/voices and returns the registered voice ids — the irodori server is the
 * source of truth for the speaker list. A down server or a malformed response must not
 * throw into boot: logs a warn and resolves to [].
 */
export async function listVoices(opts: ListVoicesOptions): Promise<string[]> {
  const log = opts.logger ?? createLogger("irodori-voices");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const voicesUrl = `${opts.baseUrl}/voices`;
  try {
    const res = await fetchImpl(voicesUrl);
    if (!res.ok) {
      log.warn("voice_list_failed", { status: res.status });
      return [];
    }
    const body = (await res.json()) as { voices?: Array<{ voice_id?: string }> };
    return (body.voices ?? [])
      .map((v) => v.voice_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch (err) {
    log.warn("voice_list_failed", { error: String(err) });
    return [];
  }
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
