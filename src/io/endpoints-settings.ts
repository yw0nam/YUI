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
  chat_model_context_window: string;
  chat_api: string;
  tts_voice: string;
  tts_provider: string;
}

export type EndpointsStorage = PersistedStorage<EndpointOverrides>;

/** Valid provider values that mergeEndpoints applies. Anything else (including empty) means no override. */
const VALID_PROVIDERS = ["irodori", "openai"] as const;

/** Valid chat_api values that mergeEndpoints applies. Anything else (including empty) means no override. */
const VALID_CHAT_APIS = ["responses", "chat_completions"] as const;

export type EndpointFieldKind = "url" | "string" | "enum" | "posInt";

/** One row per overridable endpoint value. `enum` is required (and only meaningful) for kind "enum". */
export interface EndpointFieldSpec {
  key: keyof EndpointOverrides;
  kind: EndpointFieldKind;
  enum?: readonly string[];
  /** i18n key for the field's input-row label — only url/string-kind rows render as a labeled input. */
  labelKey?: string;
  /** Per-service reset group (endpoints-section.ts's per-service reset buttons); omitted = not reset by any button. */
  resetGroup?: string;
}

/**
 * The declarative endpoint field table — FIELDS/EMPTY/coerceFor/mergeEndpoints below, the UI's
 * ENDPOINT_FIELDS (src/ui/quick-controls/constants.ts), and endpointDefaultsFromConfig all derive
 * from this one list. Adding an overridable value means adding one row here.
 */
export const ENDPOINT_FIELD_SPECS: readonly EndpointFieldSpec[] = [
  {
    key: "chat_base_url",
    kind: "url",
    labelKey: "endpoints.chat_base_url.label",
    resetGroup: "chat",
  },
  { key: "stt_base_url", kind: "url", labelKey: "endpoints.stt_base_url.label", resetGroup: "stt" },
  { key: "tts_base_url", kind: "url", labelKey: "endpoints.tts_base_url.label", resetGroup: "tts" },
  {
    key: "irodori_base_url",
    kind: "url",
    labelKey: "endpoints.irodori_base_url.label",
    resetGroup: "tts",
  },
  {
    key: "broker_base_url",
    kind: "url",
    labelKey: "endpoints.broker_base_url.label",
    resetGroup: "broker",
  },
  { key: "chat_model", kind: "string", labelKey: "endpoints.chat_model.label", resetGroup: "chat" },
  { key: "chat_model_context_window", kind: "posInt" },
  { key: "chat_api", kind: "enum", enum: VALID_CHAT_APIS, resetGroup: "chat" },
  { key: "tts_voice", kind: "string", labelKey: "endpoints.tts_voice.label", resetGroup: "tts" },
  { key: "tts_provider", kind: "enum", enum: VALID_PROVIDERS, resetGroup: "tts" },
];

const FIELDS: readonly (keyof EndpointOverrides)[] = ENDPOINT_FIELD_SPECS.map((s) => s.key);

const EMPTY: EndpointOverrides = Object.fromEntries(
  FIELDS.map((k) => [k, ""]),
) as unknown as EndpointOverrides;

const SPEC_BY_KEY: ReadonlyMap<keyof EndpointOverrides, EndpointFieldSpec> = new Map(
  ENDPOINT_FIELD_SPECS.map((s) => [s.key, s]),
);

function coerceField(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.length > ENDPOINT_VALUE_MAX_LEN ? v.slice(0, ENDPOINT_VALUE_MAX_LEN) : v;
}

/** Per-field coercion dispatch, driven by the field's declared `kind` — enum/posInt are value-restricted, url/string are string-length capped. */
function coerceFor(key: keyof EndpointOverrides, v: unknown): string {
  const spec = SPEC_BY_KEY.get(key)!;
  if (spec.kind === "enum") {
    return typeof v === "string" && spec.enum!.includes(v) ? v : "";
  }
  if (spec.kind === "posInt") {
    return typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : "";
  }
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
  const out = { ...base } as unknown as Record<string, unknown>;
  for (const spec of ENDPOINT_FIELD_SPECS) {
    const raw = ov[spec.key];
    if (spec.kind === "url") {
      const t = raw.trim();
      if (t !== "" && isValidEndpointUrl(t)) out[spec.key] = t;
    } else if (spec.kind === "string") {
      const t = raw.trim();
      if (t !== "") out[spec.key] = t;
    } else if (spec.kind === "posInt") {
      if (raw !== "") out[spec.key] = Number(raw);
    } else if (spec.kind === "enum") {
      if (spec.enum!.includes(raw)) out[spec.key] = raw;
    }
  }
  return out as unknown as EndpointsConfig;
}

/**
 * Projects a bundled EndpointsConfig onto the EndpointOverrides shape for use as UI placeholder
 * defaults ("" when a field is unset). Both main.ts and settings-main.ts call this instead of
 * hand-writing the same field-by-field literal.
 */
export function endpointDefaultsFromConfig(e: EndpointsConfig): EndpointOverrides {
  const src = e as unknown as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const key of FIELDS) {
    const raw = src[key];
    out[key] = raw === undefined || raw === null ? "" : String(raw);
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
