/**
 * 사용자가 편집 가능한 엔드포인트 오버라이드(서버 주소·모델)를 관리하는 reactive 설정 스토어.
 * 빈 값("")은 "오버라이드 없음" — bundled config 기본값으로 폴백한다. 변경 시 storage에
 * persist하고 구독자에게 통지한다. checked-in configs/endpoints.json은 mutate하지 않는다.
 */

import type { EndpointsConfig } from "../contract";

/** 각 필드 최대 길이(과도하게 긴 storage 값은 ""로 절단하지 않고 cap만 적용). */
export const ENDPOINT_VALUE_MAX_LEN = 2048;

/** 편집 가능한 5개 필드. 빈 문자열 = 오버라이드 없음. URL 필드는 isValidEndpointUrl로 검증. */
export interface EndpointOverrides {
  chat_base_url: string;
  stt_base_url: string;
  tts_base_url: string;
  irodori_base_url: string;
  chat_model: string;
}

export interface EndpointsStorage {
  load(): EndpointOverrides | null;
  save(s: EndpointOverrides): void;
}

const FIELDS: readonly (keyof EndpointOverrides)[] = [
  "chat_base_url",
  "stt_base_url",
  "tts_base_url",
  "irodori_base_url",
  "chat_model",
];

const EMPTY: EndpointOverrides = {
  chat_base_url: "",
  stt_base_url: "",
  tts_base_url: "",
  irodori_base_url: "",
  chat_model: "",
};

function coerceField(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.length > ENDPOINT_VALUE_MAX_LEN ? v.slice(0, ENDPOINT_VALUE_MAX_LEN) : v;
}

function coerce(v: unknown): EndpointOverrides {
  const s = (v ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const k of FIELDS) out[k] = coerceField(s[k]);
  return out;
}

function equals(a: EndpointOverrides, b: EndpointOverrides): boolean {
  return FIELDS.every((k) => a[k] === b[k]);
}

/**
 * URL 오버라이드 유효성. 빈/공백 문자열은 "오버라이드 없음" → 유효(에러 아님)로 본다.
 * 비어있지 않으면 trim 후 `http(s)://`로 시작하고 URL로 파싱돼야 한다.
 */
export function isValidEndpointUrl(v: string): boolean {
  const t = v.trim();
  if (t === "") return true;
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * base EndpointsConfig 위에 오버라이드를 얹어 새 EndpointsConfig를 만든다(base 비변경).
 * URL 필드는 non-empty + isValidEndpointUrl일 때만, chat_model은 non-empty일 때만 적용.
 * 적용 값은 trim한다. 무효 URL은 무시(effective는 base 기본값 유지) — UI가 에러를 따로 노출.
 */
export function mergeEndpoints(
  base: EndpointsConfig,
  ov: EndpointOverrides,
): EndpointsConfig {
  const out: EndpointsConfig = { ...base };
  const urlField = (k: "chat_base_url" | "stt_base_url" | "tts_base_url" | "irodori_base_url"): void => {
    const t = ov[k].trim();
    if (t !== "" && isValidEndpointUrl(t)) out[k] = t;
  };
  urlField("chat_base_url");
  urlField("stt_base_url");
  urlField("tts_base_url");
  urlField("irodori_base_url");
  const model = ov.chat_model.trim();
  if (model !== "") out.chat_model = model;
  return out;
}

export function createEndpointsSettings(opts?: {
  storage?: EndpointsStorage;
  initial?: EndpointOverrides;
}) {
  const storage = opts?.storage;

  let stored: EndpointOverrides | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (loaded !== null) stored = coerce(loaded);
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: EndpointOverrides = stored
    ? { ...stored }
    : opts?.initial
      ? coerce(opts.initial)
      : { ...EMPTY };

  const subscribers = new Set<(s: EndpointOverrides) => void>();

  function notify(): void {
    const copy = { ...state };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): EndpointOverrides {
      return { ...state };
    },

    set(partial: Partial<EndpointOverrides>): void {
      const next = { ...state };
      for (const k of FIELDS) {
        if (k in partial) next[k] = coerceField(partial[k]);
      }
      if (equals(state, next)) return;
      state = next;
      storage?.save({ ...state });
      notify();
    },

    reset(): void {
      if (equals(state, EMPTY)) return;
      state = { ...EMPTY };
      storage?.save({ ...state });
      notify();
    },

    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: EndpointOverrides | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (loaded === null) return;
      const next = coerce(loaded);
      if (equals(state, next)) return;
      state = next;
      notify();
    },

    subscribe(cb: (s: EndpointOverrides) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 EndpointsStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageEndpointsStorage(key = "yui.endpoints"): EndpointsStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as EndpointOverrides;
      } catch {
        return null;
      }
    },
    save(s) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(s));
      } catch {
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}
