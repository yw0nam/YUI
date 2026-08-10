/** irodori_TTS voice registry — idempotently ensures a voice id exists before synth. */

import { createLogger, type Logger } from "../logger";
import { fetchReferenceClip } from "./reference-clip";

interface EnsureRegisteredOptions {
  baseUrl: string;
  id: string;
  /** Empty for a server-listed voice (nothing to register). An asset:// URL for a user-imported clip (e.g. "asset://localhost/app-data/references/myvoice/clip.mp3"). */
  refUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
  /**
   * Rejects this caller's wait once aborted — a hung registration must not hang the caller
   * forever. Never reaches the registration fetches themselves: a shared in-flight registration
   * dedupes concurrent callers, so tying it to one caller's signal would abort the work for
   * every other caller waiting on the same voice id.
   */
  signal?: AbortSignal;
}

// Cache in-flight/settled promises so concurrent/repeat calls don't register twice. On failure, delete the entry to allow retry.
const inflight = new Map<string, Promise<void>>();

// Times the clip behind a voice id has been replaced. An import over an existing name keeps the id,
// so this is the only signal that audio rendered for that id earlier is now stale.
const revisions = new Map<string, number>();

/** How many times the reference clip behind this voice id has been replaced this session. */
export function voiceRevision(baseUrl: string, id: string): number {
  return revisions.get(`${baseUrl}::${id}`) ?? 0;
}

/** test-only: prevents cache leakage between cases. */
export function __resetIrodoriVoiceCache(): void {
  inflight.clear();
  revisions.clear();
}

/** When server-side voice deletion (restart/DELETE) causes a 422, clear the memo to allow re-registration. */
export function evictRegistration(baseUrl: string, id: string): void {
  inflight.delete(`${baseUrl}::${id}`);
}

// Shared across every caller dedup routes to the same in-flight registration, so this never
// takes a caller's signal — one caller's abort must not cancel the fetches for the others.
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

  const blob = await fetchReferenceClip(opts.refUrl, { fetch: fetchImpl });

  const form = new FormData();
  form.append("reference_audio", blob, `${opts.id}.mp3`);
  form.append("voice_id", opts.id);

  const postRes = await fetchImpl(voicesUrl, { method: "POST", body: form });
  if (!postRes.ok) {
    throw new Error(`irodori voice register failed (HTTP ${postRes.status}) ${opts.id}`);
  }
  log.info("voice_registered", { id: opts.id });
}

/** Rejects once `signal` aborts, independent of how `task` itself settles — lets one caller
 *  bail out of a shared in-flight registration without affecting the other callers on it. */
function rejectOnAbort<T>(task: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

interface UpdateVoiceOptions {
  baseUrl: string;
  id: string;
  refUrl: string;
  fetch?: typeof fetch;
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

  const blob = await fetchReferenceClip(opts.refUrl, { fetch: fetchImpl });

  // voice_id travels in the path — PUT /voices/{voice_id}'s body schema takes only reference_audio.
  const form = new FormData();
  form.append("reference_audio", blob, `${opts.id}.mp3`);

  const putRes = await fetchImpl(`${opts.baseUrl}/voices/${encodeURIComponent(opts.id)}`, {
    method: "PUT",
    body: form,
  });
  if (!putRes.ok) {
    throw new Error(`irodori voice update failed (HTTP ${putRes.status}) ${opts.id}`);
  }
  const key = `${opts.baseUrl}::${opts.id}`;
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
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

  let task = inflight.get(key);
  if (!task) {
    task = register(opts, log).catch((err: unknown) => {
      inflight.delete(key);
      throw err;
    });
    inflight.set(key, task);
  }
  return rejectOnAbort(task, opts.signal);
}
