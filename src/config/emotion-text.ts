/**
 * emotion-text.ts — per-provider emotion_text emoji table loader.
 *
 * configs/emotion_text/<provider>.json = `{ "<emoji>": "<English meaning hint>" }`.
 * irodori publishes this table to the Expression Broker as enum vocab (broker-client, separate unit).
 * Pure load + validation only (no side effects, reader injectable → testable). fail-loud ConfigError.
 */

import { resolveAssetUrl } from "../io/asset-url";
import { type AssetUrlResolver, ConfigError, type ConfigReader } from "./load";

export interface LoadEmotionTextOptions {
  /** provider key in configs/emotion_text/<provider>.json (e.g. "irodori"). */
  provider: string;
  /** File reader injection (tests). Defaults to the fetch-based reader when unset. */
  read?: ConfigReader;
  /** Prefix the default reader prepends. default `/configs`. */
  baseUrl?: string;
  /** Logical path → runtime URL resolver (injectable). Defaults to resolveAssetUrl. */
  resolveUrl?: AssetUrlResolver;
  /** fetch injection (tests). Defaults to globalThis.fetch when unset. */
  fetch?: typeof fetch;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Default fetch-based reader (browser/Tauri webview runtime). */
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
 * Reads configs/emotion_text/<provider>.json and returns a validated Record<string,string>.
 * Fails immediately with ConfigError on non-object / empty object / non-string value (fail-loud).
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
