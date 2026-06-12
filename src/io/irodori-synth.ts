/** 한 문장 input → POST {baseUrl}/synthesize (multipart) → wav ArrayBuffer (irodori_TTS). */

import { createLogger, type Logger } from "../logger";

export interface IrodoriSynthOptions {
  baseUrl: string;
  referenceId: string;
  fetch?: typeof fetch;
  numSteps?: number;
  cfgScaleText?: number;
  cfgScaleSpeaker?: number;
  seconds?: number;
  logger?: Logger;
  /** test seam — 503 Retry-After 대기. 기본은 AbortSignal을 존중하는 setTimeout. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type TtsSynth = (input: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

/** status를 실어 보내 호출부가 422/503 등을 분기할 수 있게 한다. */
export class IrodoriSynthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "IrodoriSynthError";
    this.status = status;
  }
}

const RETRY_AFTER_CAP_MS = 5000;
const RETRY_AFTER_DEFAULT_MS = 500;

/** detail은 문자열·{msg}[]·기타 — 사람이 읽을 한 줄로 환원, 미문서화 형태는 JSON 폴백. */
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

/** Retry-After(초) 파싱 → ms, 상한 클램프. 헤더 없으면 작은 기본값. */
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

/** Server-Timing의 `total;dur=NNN` 세그먼트에서 ms 추출. */
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

    // 503 overloaded: Retry-After를 한 번만 존중해 재시도(transient drop 방지).
    if (res.status === 503) {
      const waitMs = retryAfterMs(res.headers.get("Retry-After"));
      log.warn("synth 503 overloaded — retrying once", { wait_ms: waitMs });
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
