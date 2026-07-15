/**
 * Reactive settings store managing user-editable endpoint overrides (server addresses and models).
 * An empty value ("") means "no override" — falls back to the bundled config default. Persists to
 * storage on change and notifies subscribers. Never mutates the checked-in configs/endpoints.json.
 */

import type { EndpointsConfig } from "../contract";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

/** Max length per field (overly long storage values are capped, not reset to ""). */
export const ENDPOINT_VALUE_MAX_LEN = 2048;

/**
 * Editable override fields. Empty string = no override. URL fields are validated by isValidEndpointUrl.
 * tts_provider is valid only as "irodori"|"openai" — anything else (including empty) means no override.
 * chat_api is valid only as "responses"|"chat_completions" — anything else (including empty) means no override.
 */
export interface EndpointOverrides {
  chat_base_url: string;
  stt_base_url: string;
  tts_base_url: string;
  irodori_base_url: string;
  broker_base_url: string;
  chat_model: string;
  chat_api: string;
  tts_voice: string;
  tts_provider: string;
}

export type EndpointsStorage = PersistedStorage<EndpointOverrides>;

const FIELDS: readonly (keyof EndpointOverrides)[] = [
  "chat_base_url",
  "stt_base_url",
  "tts_base_url",
  "irodori_base_url",
  "broker_base_url",
  "chat_model",
  "chat_api",
  "tts_voice",
  "tts_provider",
];

const EMPTY: EndpointOverrides = {
  chat_base_url: "",
  stt_base_url: "",
  tts_base_url: "",
  irodori_base_url: "",
  broker_base_url: "",
  chat_model: "",
  chat_api: "",
  tts_voice: "",
  tts_provider: "",
};

/** Valid provider values that mergeEndpoints applies. Anything else (including empty) means no override. */
const VALID_PROVIDERS = ["irodori", "openai"] as const;

/** Valid chat_api values that mergeEndpoints applies. Anything else (including empty) means no override. */
const VALID_CHAT_APIS = ["responses", "chat_completions"] as const;

function coerceField(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.length > ENDPOINT_VALUE_MAX_LEN ? v.slice(0, ENDPOINT_VALUE_MAX_LEN) : v;
}

/** tts_provider-specific coercion — drops to "" (no override) if not a valid enum. */
function coerceProvider(v: unknown): string {
  return typeof v === "string" && (VALID_PROVIDERS as readonly string[]).includes(v) ? v : "";
}

/** chat_api-specific coercion — drops to "" (no override) if not a valid enum. */
function coerceChatApi(v: unknown): string {
  return typeof v === "string" && (VALID_CHAT_APIS as readonly string[]).includes(v) ? v : "";
}

/** Per-field coercion dispatch — tts_provider/chat_api are enum-restricted, the rest are string-length capped. */
function coerceFor(key: keyof EndpointOverrides, v: unknown): string {
  if (key === "tts_provider") return coerceProvider(v);
  if (key === "chat_api") return coerceChatApi(v);
  return coerceField(v);
}

function coerce(v: unknown): EndpointOverrides {
  const s = (v ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const k of FIELDS) out[k] = coerceFor(k, s[k]);
  return out;
}

function equals(a: EndpointOverrides, b: EndpointOverrides): boolean {
  return FIELDS.every((k) => a[k] === b[k]);
}

/**
 * URL override validity. Empty/whitespace strings count as "no override" → valid (not an error).
 * If non-empty, after trimming it must start with `http(s)://` and parse as a URL.
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
 * Builds a new EndpointsConfig by layering overrides onto the base EndpointsConfig (base unchanged).
 * URL fields apply only when non-empty + isValidEndpointUrl, chat_model only when non-empty,
 * tts_provider only when a valid enum ("irodori"|"openai"), and chat_api only when a valid enum
 * ("responses"|"chat_completions"). Applied values are trimmed.
 * Invalid URL/provider/chat_api are ignored (effective keeps the base default) — the UI surfaces the error separately.
 */
export function mergeEndpoints(base: EndpointsConfig, ov: EndpointOverrides): EndpointsConfig {
  const out: EndpointsConfig = { ...base };
  const urlField = (
    k: "chat_base_url" | "stt_base_url" | "tts_base_url" | "irodori_base_url" | "broker_base_url",
  ): void => {
    const t = ov[k].trim();
    if (t !== "" && isValidEndpointUrl(t)) out[k] = t;
  };
  urlField("chat_base_url");
  urlField("stt_base_url");
  urlField("tts_base_url");
  urlField("irodori_base_url");
  urlField("broker_base_url");
  const model = ov.chat_model.trim();
  if (model !== "") out.chat_model = model;
  const voice = ov.tts_voice.trim();
  if (voice !== "") out.tts_voice = voice;
  if (ov.tts_provider === "irodori" || ov.tts_provider === "openai") {
    out.tts_provider = ov.tts_provider;
  }
  if (ov.chat_api === "responses" || ov.chat_api === "chat_completions") {
    out.chat_api = ov.chat_api;
  }
  return out;
}

export function createEndpointsSettings(opts?: {
  storage?: EndpointsStorage;
  initial?: EndpointOverrides;
}) {
  const core = createPersistedStore<EndpointOverrides>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...EMPTY },
    parse: (v) => (v === null ? null : coerce(v)),
    fromInitial: coerce,
    equals,
  });

  return {
    get: core.get,

    set(partial: Partial<EndpointOverrides>): void {
      const next = { ...core.current() };
      for (const k of FIELDS) {
        if (k in partial) next[k] = coerceFor(k, partial[k]);
      }
      core.commit(next);
    },

    reset(): void {
      core.commit({ ...EMPTY });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-based EndpointsStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageEndpointsStorage(key = "yui.endpoints"): EndpointsStorage {
  return localStorageStore<EndpointOverrides>(key);
}
