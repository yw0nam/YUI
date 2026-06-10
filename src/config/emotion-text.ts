/**
 * emotion-text.ts — provider별 emotion_text 이모지 테이블 로더.
 *
 * configs/emotion_text/<provider>.json = `{ "<emoji>": "<English meaning hint>" }`.
 * irodori는 이 테이블을 Expression Broker에 enum vocab으로 publish한다(broker-client, 별도 unit).
 * 순수 로드+검증만 담당(부수효과 없음, reader 주입 가능 → 테스트). fail-loud ConfigError.
 */

import { ConfigError, type AssetUrlResolver, type ConfigReader } from "./load";
import { resolveAssetUrl } from "../io/asset-url";

export interface LoadEmotionTextOptions {
  /** configs/emotion_text/<provider>.json의 provider 키(예: "irodori"). */
  provider: string;
  /** 파일 reader 주입(테스트). 미지정 시 fetch 기반 기본 reader. */
  read?: ConfigReader;
  /** 기본 reader가 붙일 prefix. default `/configs`. */
  baseUrl?: string;
  /** 논리 경로 → 런타임 URL 변환기(주입 가능). 기본은 resolveAssetUrl. */
  resolveUrl?: AssetUrlResolver;
  /** fetch 주입(테스트). 미지정 시 globalThis.fetch. */
  fetch?: typeof fetch;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** fetch 기반 기본 reader (브라우저/Tauri webview 런타임). */
function fetchReader(
  baseUrl: string,
  resolveUrl: AssetUrlResolver = resolveAssetUrl,
  fetchImpl: typeof fetch = globalThis.fetch,
): ConfigReader {
  return async (file) => {
    const url = await resolveUrl(`${baseUrl}/${file}`);
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new ConfigError(file, [`HTTP ${res.status} ${res.statusText} (${url})`]);
    }
    try {
      return await res.json();
    } catch {
      throw new ConfigError(file, ["응답이 JSON이 아님"]);
    }
  };
}

/**
 * configs/emotion_text/<provider>.json을 읽어 검증된 Record<string,string>로 반환한다.
 * 객체가 아님 / 빈 객체 / 비-문자열 값이면 ConfigError로 즉시 실패한다(fail-loud).
 */
export async function loadEmotionTextTable(
  opts: LoadEmotionTextOptions,
): Promise<Record<string, string>> {
  const read = opts.read ?? fetchReader(opts.baseUrl ?? "/configs", opts.resolveUrl, opts.fetch);
  const file = `emotion_text/${opts.provider}.json`;
  const raw = await read(file);

  if (!isObject(raw)) {
    throw new ConfigError(file, ["객체가 아님"]);
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new ConfigError(file, ["빈 테이블 — 최소 1개 항목이 필요함"]);
  }
  const issues: string[] = [];
  const out: Record<string, string> = {};
  for (const [emoji, meaning] of entries) {
    if (typeof meaning !== "string") {
      issues.push(`${emoji}의 값은 문자열이어야 함 (받음: ${JSON.stringify(meaning)})`);
      continue;
    }
    out[emoji] = meaning;
  }
  if (issues.length > 0) throw new ConfigError(file, issues);
  return out;
}
