/** Single-sentence input → POST {baseUrl}/synthesize (multipart) → wav ArrayBuffer (irodori_TTS). */

import { createLogger, type Logger } from "../logger";
import { createDeadlineSignal } from "./deadline";
import { ensureRegistered, evictRegistration, voiceRevision } from "./irodori-voices";
import {
  emotionTextModeFor,
  TTS_SYNTH_TIMEOUT_MS,
  type TtsProvider,
  type TtsSynth,
} from "./tts-provider";

export type { TtsSynth };

interface IrodoriSynthOptions {
  baseUrl: string;
  referenceId: string;
  fetch?: typeof fetch;
  numSteps?: number;
  cfgScaleText?: number;
  cfgScaleSpeaker?: number;
  seconds?: number;
  logger?: Logger;
  /** test seam — waits out a 503 Retry-After. Defaults to a setTimeout that respects AbortSignal. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Carries status so the provider adapter can detect a 422 (unknown reference_id) and self-heal. */
class IrodoriSynthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "IrodoriSynthError";
    this.status = status;
  }
}

const RETRY_AFTER_CAP_MS = 5000;
const RETRY_AFTER_DEFAULT_MS = 500;

/** detail is a string, {msg}[], or other — reduce to one human-readable line; JSON-fallback for undocumented shapes. */
function formatDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return "";
  if (typeof detail === "string") return `: ${detail}`;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) =>
        d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : "",
      )
      .filter(Boolean);
    if (msgs.length) return `: ${msgs.join("; ")}`;
  }
  try {
    return `: ${JSON.stringify(detail)}`;
  } catch {
    return "";
  }
}

/** Parse Retry-After (seconds) → ms, clamped to a cap. Small default when the header is absent. */
function retryAfterMs(header: string | null): number {
  if (!header) return RETRY_AFTER_DEFAULT_MS;
  const secs = Number(header);
  if (!Number.isFinite(secs) || secs <= 0) return RETRY_AFTER_DEFAULT_MS;
  return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Extract ms from the `total;dur=NNN` segment of Server-Timing. */
function parseTotalMs(serverTiming: string | null): number | undefined {
  if (!serverTiming) return undefined;
  const m = /total;dur=([0-9.]+)/.exec(serverTiming);
  return m ? Number(m[1]) : undefined;
}

export function createIrodoriSynth(opts: IrodoriSynthOptions): TtsSynth {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `${opts.baseUrl}/synthesize`;
  const log = opts.logger ?? createLogger("irodori-synth");
  const sleep = opts.sleep ?? defaultSleep;

  const buildForm = (input: string): FormData => {
    const form = new FormData();
    form.append("text", input);
    form.append("reference_id", opts.referenceId);
    if (opts.numSteps !== undefined) form.append("num_steps", String(opts.numSteps));
    if (opts.cfgScaleText !== undefined) form.append("cfg_scale_text", String(opts.cfgScaleText));
    if (opts.cfgScaleSpeaker !== undefined)
      form.append("cfg_scale_speaker", String(opts.cfgScaleSpeaker));
    if (opts.seconds !== undefined) form.append("seconds", String(opts.seconds));
    return form;
  };

  const errorFrom = async (res: Response): Promise<IrodoriSynthError> => {
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: unknown };
      detail = formatDetail(j?.detail);
    } catch {
      /* non-JSON body */
    }
    return new IrodoriSynthError(
      `irodori synthesize failed (HTTP ${res.status})${detail}`,
      res.status,
    );
  };

  return async (input, signal) => {
    let res = await fetchImpl(url, { method: "POST", body: buildForm(input), signal });

    // 503 overloaded: honor Retry-After once and retry (prevents transient drops).
    if (res.status === 503) {
      const waitMs = retryAfterMs(res.headers.get("Retry-After"));
      log.warn("synth_overloaded", { status: 503, retry: true, wait_ms: waitMs });
      await sleep(waitMs, signal);
      res = await fetchImpl(url, { method: "POST", body: buildForm(input), signal });
    }

    if (!res.ok) throw await errorFrom(res);

    const buf = await res.arrayBuffer();
    log.debug("synth", {
      rtf: res.headers.get("X-RTF") ?? undefined,
      total_ms: parseTotalMs(res.headers.get("Server-Timing")),
      bytes: buf.byteLength,
    });
    return buf;
  };
}

interface IrodoriSynthParams {
  baseUrl: string;
  referenceId: string;
  refUrl: string;
  numSteps?: number;
  cfgScaleText?: number;
  cfgScaleSpeaker?: number;
  seconds?: number;
}

/** The params that change the rendered audio — memo identity here, cache identity for callers. */
function irodoriParamsKey(p: IrodoriSynthParams): string {
  return [p.baseUrl, p.referenceId, p.numSteps, p.cfgScaleText, p.cfgScaleSpeaker, p.seconds].join(
    "::",
  );
}

export interface IrodoriTtsProviderDeps {
  getEndpoints: () => {
    irodori_base_url?: string;
    irodori_num_steps?: number;
    irodori_cfg_scale_text?: number;
    irodori_cfg_scale_speaker?: number;
    irodori_seconds?: number;
  };
  getActiveSpeaker: () => { id: string; ref_url: string };
  /** Environment fetch override (Tauri CORS-bypass) — resolved fresh on every synth() call. */
  selectFetch: () => Promise<typeof fetch | undefined>;
  logger?: Logger;
}

/**
 * Runs one network step under its own deadline so a hung fetch settles instead of hanging
 * forever. Scoped per step (not around the whole synth() call) because irodori's local
 * diffusion synth time is unmeasured — see TTS_SYNTH_TIMEOUT_MS (tts-provider.ts) for the
 * full reasoning.
 */
async function withDeadline<T>(
  signal: AbortSignal | undefined,
  fn: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = createDeadlineSignal(TTS_SYNTH_TIMEOUT_MS, "irodori TTS request timed out");
  const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    return await fn(requestSignal);
  } finally {
    deadline.clear();
  }
}

/**
 * TtsProvider adapter over irodori_TTS. Internalizes voice registration (ensureRegistered),
 * the per-sentence synth closure memoized by speaker/tuning identity (not rebuilt each sentence),
 * and the 422 (unknown reference_id) self-heal: evict the registration memo, re-register once,
 * retry the synth once.
 */
export function createIrodoriTtsProvider(deps: IrodoriTtsProviderDeps): TtsProvider {
  const params = (): IrodoriSynthParams => {
    const eps = deps.getEndpoints();
    const active = deps.getActiveSpeaker();
    if (!eps.irodori_base_url || !active.id) {
      throw new Error("irodori provider requires irodori_base_url + irodori_speaker");
    }
    return {
      baseUrl: eps.irodori_base_url,
      referenceId: active.id,
      refUrl: active.ref_url,
      numSteps: eps.irodori_num_steps,
      cfgScaleText: eps.irodori_cfg_scale_text,
      cfgScaleSpeaker: eps.irodori_cfg_scale_speaker,
      seconds: eps.irodori_seconds,
    };
  };

  // The built createIrodoriSynth closure must not be rebuilt each sentence, memoized by the
  // params that change the rendered audio.
  let cachedKey: string | undefined;
  let cachedSynth: TtsSynth | undefined;
  const synthFor = (p: IrodoriSynthParams, fetchImpl: typeof fetch): TtsSynth => {
    const key = irodoriParamsKey(p);
    if (key !== cachedKey || !cachedSynth) {
      cachedSynth = createIrodoriSynth({
        baseUrl: p.baseUrl,
        referenceId: p.referenceId,
        fetch: fetchImpl,
        numSteps: p.numSteps,
        cfgScaleText: p.cfgScaleText,
        cfgScaleSpeaker: p.cfgScaleSpeaker,
        seconds: p.seconds,
        logger: deps.logger,
      });
      cachedKey = key;
    }
    return cachedSynth;
  };

  return {
    synth: async (input, signal) => {
      const fetchImpl = (await deps.selectFetch()) ?? globalThis.fetch;
      const p = params();
      const register = (requestSignal: AbortSignal): Promise<void> =>
        ensureRegistered({
          baseUrl: p.baseUrl,
          id: p.referenceId,
          refUrl: p.refUrl,
          fetch: fetchImpl,
          signal: requestSignal,
        });
      const synthFn = synthFor(p, fetchImpl);

      // Each step (registration, synth, and the 422 self-heal's re-registration + retry) runs
      // under its own deadline — see withDeadline.
      await withDeadline(signal, register);
      try {
        return await withDeadline(signal, (requestSignal) => synthFn(input, requestSignal));
      } catch (err) {
        if (!(err instanceof IrodoriSynthError) || err.status !== 422) throw err;
        // Server forgot the voice — evict the memo, re-register once, retry once.
        evictRegistration(p.baseUrl, p.referenceId);
        await withDeadline(signal, register);
        return await withDeadline(signal, (requestSignal) => synthFn(input, requestSignal));
      }
    },
    // The irodori voice revision is part of the key because an import over an existing name
    // replaces the clip without changing the speaker id.
    paramsKey: () => {
      const p = params();
      return `irodori::${irodoriParamsKey(p)}::${voiceRevision(p.baseUrl, p.referenceId)}`;
    },
    isReady: () => {
      const eps = deps.getEndpoints();
      return Boolean(eps.irodori_base_url && deps.getActiveSpeaker().id);
    },
    emotionTextMode: () => emotionTextModeFor("irodori"),
  };
}
