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
}

export type TtsSynth = (input: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

/** detail은 문자열이거나 {msg}[] 배열 — 둘 다 사람이 읽을 한 줄로 환원. */
function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return `: ${detail}`;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : ""))
      .filter(Boolean);
    if (msgs.length) return `: ${msgs.join("; ")}`;
  }
  return "";
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

  return async (input, signal) => {
    const form = new FormData();
    form.append("text", input);
    form.append("reference_id", opts.referenceId);
    if (opts.numSteps !== undefined) form.append("num_steps", String(opts.numSteps));
    if (opts.cfgScaleText !== undefined) form.append("cfg_scale_text", String(opts.cfgScaleText));
    if (opts.cfgScaleSpeaker !== undefined)
      form.append("cfg_scale_speaker", String(opts.cfgScaleSpeaker));
    if (opts.seconds !== undefined) form.append("seconds", String(opts.seconds));

    const res = await fetchImpl(url, { method: "POST", body: form, signal });

    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { detail?: unknown };
        detail = formatDetail(j?.detail);
      } catch {
        /* non-JSON body */
      }
      throw new Error(`irodori synthesize failed (HTTP ${res.status})${detail}`);
    }

    const buf = await res.arrayBuffer();
    log.debug("synth", {
      rtf: res.headers.get("X-RTF") ?? undefined,
      total_ms: parseTotalMs(res.headers.get("Server-Timing")),
      bytes: buf.byteLength,
    });
    return buf;
  };
}
