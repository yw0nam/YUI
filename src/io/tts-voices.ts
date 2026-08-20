/** OpenAI-compatible voices API — lists, uploads, and deletes reference voices. */

import { createLogger, type Logger } from "../logger";
import { fetchReferenceClip } from "./reference-clip";

interface VoicesRequestOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Resolves the TTS server key (Bearer) per request. Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  logger?: Logger;
}

async function authHeaders(
  getApiKey: (() => Promise<string | undefined>) | undefined,
): Promise<Record<string, string>> {
  const key = (await getApiKey?.())?.trim() || undefined;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Reduces an OpenAI-style `{error:{message}}` body to one appendable line. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j?.error?.message ? `: ${j.error.message}` : "";
  } catch {
    return "";
  }
}

/**
 * GETs {baseUrl}/v1/audio/voices and returns the server's voice ids — the TTS server is the
 * source of truth for the speaker list, and its ids are opaque strings (non-ASCII included).
 * A down server or a malformed response must not throw into boot: logs a warn and resolves to [].
 */
export async function listVoices(opts: VoicesRequestOptions): Promise<string[]> {
  const log = opts.logger ?? createLogger("tts-voices");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  try {
    const res = await fetchImpl(`${opts.baseUrl}/v1/audio/voices`, {
      headers: await authHeaders(opts.getApiKey),
    });
    if (!res.ok) {
      log.warn("voice_list_failed", { status: res.status });
      return [];
    }
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? [])
      .map((v) => v.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch (err) {
    log.warn("voice_list_failed", { error: String(err) });
    return [];
  }
}

/** The server validates the uploaded filename's extension, so it follows the imported clip. */
function extensionOf(refUrl: string): string {
  const path = refUrl.split(/[?#]/)[0];
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1];
  if (!ext) throw new Error(`reference clip has no file extension: ${refUrl}`);
  return ext.toLowerCase();
}

interface UpsertVoiceOptions extends VoicesRequestOptions {
  id: string;
  /** asset:// URL of the reference clip (e.g. "asset://localhost/app-data/references/myvoice/clip.wav"). */
  refUrl: string;
}

/**
 * Create-or-replace: POSTs the clip, and on 409 (the id already exists) PUTs over it. Callers
 * therefore never branch on whether the server already knows the voice.
 */
export async function upsertVoice(opts: UpsertVoiceOptions): Promise<void> {
  const log = opts.logger ?? createLogger("tts-voices");
  if (!opts.refUrl) {
    throw new Error("upsertVoice requires a reference clip");
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const filename = `${opts.id}.${extensionOf(opts.refUrl)}`;
  const blob = await fetchReferenceClip(opts.refUrl, { fetch: fetchImpl });
  const headers = await authHeaders(opts.getApiKey);
  const voicesUrl = `${opts.baseUrl}/v1/audio/voices`;

  const createForm = new FormData();
  createForm.append("file", blob, filename);
  createForm.append("voice_id", opts.id);
  let res = await fetchImpl(voicesUrl, { method: "POST", body: createForm, headers });

  if (res.status === 409) {
    // voice_id travels in the path — PUT's body takes only the clip.
    const replaceForm = new FormData();
    replaceForm.append("file", blob, filename);
    res = await fetchImpl(`${voicesUrl}/${encodeURIComponent(opts.id)}`, {
      method: "PUT",
      body: replaceForm,
      headers,
    });
  }

  if (!res.ok) {
    throw new Error(`TTS voice upload failed (HTTP ${res.status})${await errorDetail(res)}`);
  }
  log.info("voice_uploaded", { id: opts.id });
}

export async function deleteVoice(opts: VoicesRequestOptions & { id: string }): Promise<void> {
  const log = opts.logger ?? createLogger("tts-voices");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${opts.baseUrl}/v1/audio/voices/${encodeURIComponent(opts.id)}`, {
    method: "DELETE",
    headers: await authHeaders(opts.getApiKey),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`TTS voice delete failed (HTTP ${res.status})${await errorDetail(res)}`);
  }
  log.info("voice_deleted", { id: opts.id });
}
