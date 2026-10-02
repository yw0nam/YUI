/**
 * Fish Audio's `/model` API — lists the account's voice models, imports one from a clip,
 * deletes one. Pagination follows `has_more`, falling back to `total`.
 */

import { createLogger } from "../../../logger";
import { createDeadlineSignal, untilAborted } from "../deadline";
import { fetchReferenceClip } from "./reference-clip";
import {
  authHeaders,
  clipExtensionOf,
  type UpsertVoiceOptions,
  VOICE_UPLOAD_TIMEOUT_MS,
  VOICES_REQUEST_TIMEOUT_MS,
  type VoiceEntry,
  type VoicesRequestOptions,
} from "./tts-voices";

const PAGE_SIZE = 100;

/** Reduces a Fish error body (`message` or `detail`) to one appendable line. */
async function errorDetail(res: Response, signal: AbortSignal): Promise<string> {
  try {
    const j = (await untilAborted(res.json(), signal)) as { message?: unknown; detail?: unknown };
    const line = [j?.message, j?.detail].find((v) => typeof v === "string" && v.length > 0);
    return typeof line === "string" ? `: ${line}` : "";
  } catch {
    return "";
  }
}

/**
 * GETs {baseUrl}/model?self=true across every page and returns the account's voice models —
 * `_id` is the synthesizable reference_id, `title` the visible label. A failed request (non-2xx,
 * thrown request, deadline timeout) resolves to null so the caller can tell it from a genuinely
 * empty account, which resolves to [].
 */
export async function listFishVoices(opts: VoicesRequestOptions): Promise<VoiceEntry[] | null> {
  const log = opts.logger ?? createLogger("fish-voices");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const deadline = createDeadlineSignal(VOICES_REQUEST_TIMEOUT_MS, "Fish voice list timed out");
  try {
    const voices: VoiceEntry[] = [];
    for (let page = 1; ; page++) {
      const res = await untilAborted(
        fetchImpl(`${opts.baseUrl}/model?self=true&page_size=${PAGE_SIZE}&page_number=${page}`, {
          headers: await authHeaders(opts.getApiKey),
          signal: deadline.signal,
        }),
        deadline.signal,
      );
      if (!res.ok) {
        log.warn("voice_list_failed", { status: res.status });
        return null;
      }
      const body = (await untilAborted(res.json(), deadline.signal)) as {
        total?: unknown;
        has_more?: unknown;
        items?: Array<{ _id?: unknown; title?: unknown }>;
      };
      const items = body.items ?? [];
      for (const item of items) {
        if (typeof item._id === "string" && item._id.length > 0) {
          voices.push({
            id: item._id,
            ...(typeof item.title === "string" && item.title.length > 0
              ? { label: item.title }
              : {}),
          });
        }
      }
      // has_more decides when the server sends it; total is the fallback.
      const total = typeof body.total === "number" ? body.total : Infinity;
      const more = typeof body.has_more === "boolean" ? body.has_more : voices.length < total;
      // An empty page ends the walk even when has_more claims otherwise — never loop forever.
      if (items.length === 0 || !more) break;
    }
    return voices;
  } catch (err) {
    log.warn("voice_list_failed", { error: String(err) });
    return null;
  } finally {
    deadline.clear();
  }
}

/**
 * POSTs the clip as a new voice model and resolves the server-assigned `_id` — Fish names its
 * own models, so the caller must adopt the returned id instead of a local one.
 */
export async function upsertFishVoice(opts: UpsertVoiceOptions): Promise<string> {
  const log = opts.logger ?? createLogger("fish-voices");
  if (!opts.refUrl) {
    throw new Error("upsertFishVoice requires a reference clip");
  }
  const deadline = createDeadlineSignal(VOICE_UPLOAD_TIMEOUT_MS, "Fish voice upload timed out");
  try {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    const blob = await untilAborted(
      fetchReferenceClip(opts.refUrl, { fetch: fetchImpl, signal: deadline.signal }),
      deadline.signal,
    );
    const form = new FormData();
    form.append("type", "tts");
    form.append("title", opts.name?.trim() || opts.id);
    form.append("train_mode", "fast");
    form.append("voices", blob, `voice.${clipExtensionOf(opts.refUrl)}`);
    const res = await untilAborted(
      fetchImpl(`${opts.baseUrl}/model`, {
        method: "POST",
        body: form,
        headers: await authHeaders(opts.getApiKey),
        signal: deadline.signal,
      }),
      deadline.signal,
    );
    if (!res.ok) {
      throw new Error(
        `Fish voice upload failed (HTTP ${res.status})${await errorDetail(res, deadline.signal)}`,
      );
    }
    const body = (await untilAborted(res.json(), deadline.signal)) as { _id?: unknown };
    if (typeof body._id !== "string" || body._id.length === 0) {
      throw new Error("Fish voice upload returned no model id");
    }
    log.info("voice_uploaded", { id: body._id });
    return body._id;
  } finally {
    deadline.clear();
  }
}

export async function deleteFishVoice(opts: VoicesRequestOptions & { id: string }): Promise<void> {
  const log = opts.logger ?? createLogger("fish-voices");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const deadline = createDeadlineSignal(VOICES_REQUEST_TIMEOUT_MS, "Fish voice delete timed out");
  try {
    const res = await untilAborted(
      fetchImpl(`${opts.baseUrl}/model/${encodeURIComponent(opts.id)}`, {
        method: "DELETE",
        headers: await authHeaders(opts.getApiKey),
        signal: deadline.signal,
      }),
      deadline.signal,
    );
    const detail = res.ok ? "" : await errorDetail(res, deadline.signal);
    if (!res.ok) {
      throw new Error(`Fish voice delete failed (HTTP ${res.status})${detail}`);
    }
    log.info("voice_deleted", { id: opts.id });
  } finally {
    deadline.clear();
  }
}
