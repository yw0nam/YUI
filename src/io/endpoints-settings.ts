/**
 * Reactive settings store managing user-editable endpoint overrides (server addresses and models).
 * An empty value ("") means "no override" — falls back to the bundled config default. Persists to
 * storage on change and notifies subscribers. Never mutates the checked-in configs/endpoints.json.
 */

import type { EndpointsConfig } from "../contract";
import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "./persisted-store";
import type { TtsProviderKind } from "./tts-provider";

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

/**
 * Valid provider values that mergeEndpoints applies. Anything else (including empty) means no
 * override. Typed against tts-provider.ts's TtsProviderKind so this list and the provider
 * module's own enum can't silently drift.
 */
const VALID_PROVIDERS: readonly TtsProviderKind[] = ["irodori", "openai"];

/** Valid chat_api values that mergeEndpoints applies. Anything else (including empty) means no override. */
const VALID_CHAT_APIS = ["responses", "chat_completions"] as const;

export type EndpointFieldKind = "url" | "string" | "enum" | "posInt";

interface EndpointFieldBase {
  key: keyof EndpointOverrides;
  /** Per-service reset group (endpoints-section.ts's per-service reset buttons); omitted = not reset by any button. */
  resetGroup?: string;
}

/** url/string-kind rows render as a labeled text-input row (src/ui/quick-controls/constants.ts's ENDPOINT_FIELDS). */
export interface EndpointTextFieldSpec extends EndpointFieldBase {
  kind: "url" | "string";
  labelKey: string;
}

/** enum-kind rows are value-restricted; anything outside `enum` (including "") coerces to "" (no override). */
export interface EndpointEnumFieldSpec extends EndpointFieldBase {
  kind: "enum";
  enum: readonly string[];
}

/** posInt-kind rows accept only positive digit strings ("0", "abc", "" all coerce to "" — no override). */
export interface EndpointPosIntFieldSpec extends EndpointFieldBase {
  kind: "posInt";
}

/** One row per overridable endpoint value — a discriminated union on `kind` so `enum`/`labelKey` are only required where they're meaningful. */
export type EndpointFieldSpec =
  | EndpointTextFieldSpec
  | EndpointEnumFieldSpec
  | EndpointPosIntFieldSpec;

/**
 * The declarative endpoint field table — FIELDS/EMPTY/coerceFor/mergeEndpoints below, the UI's
 * ENDPOINT_FIELDS (src/ui/quick-controls/constants.ts), and endpointDefaultsFromConfig all derive
 * from this one list. Adding an overridable value means adding one row here.
 */
export const ENDPOINT_FIELD_SPECS = [
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
  // No resetGroup: no reset button clears this today (the "chat" service reset only clears
  // chat_base_url/chat_model/chat_api) — see endpoints-settings.test.ts's resetGroup pin test.
  { key: "chat_model_context_window", kind: "posInt", resetGroup: undefined },
  { key: "chat_api", kind: "enum", enum: VALID_CHAT_APIS, resetGroup: "chat" },
  { key: "tts_voice", kind: "string", labelKey: "endpoints.tts_voice.label", resetGroup: "tts" },
  { key: "tts_provider", kind: "enum", enum: VALID_PROVIDERS, resetGroup: "tts" },
] as const satisfies readonly EndpointFieldSpec[];

/** Literal union of every key declared above — used by the totality guard below. */
type SpecKeys = (typeof ENDPOINT_FIELD_SPECS)[number]["key"];

/**
 * Compile-time totality guard: if EndpointOverrides gains a field without a matching row above,
 * `_MissingFieldSpecRows` stops being `never` and this line fails to typecheck — `pnpm build`
 * catches the gap, not just the runtime test in endpoints-settings.test.ts.
 */
type _MissingFieldSpecRows = Exclude<keyof EndpointOverrides, SpecKeys>;
const _totalityGuard: _MissingFieldSpecRows extends never ? true : _MissingFieldSpecRows = true;
void _totalityGuard;

const FIELDS: readonly (keyof EndpointOverrides)[] = ENDPOINT_FIELD_SPECS.map((s) => s.key);

const EMPTY: EndpointOverrides = Object.fromEntries(FIELDS.map((k) => [k, ""])) as Record<
  SpecKeys,
  string
>;

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
    return typeof v === "string" && spec.enum.includes(v) ? v : "";
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

/** Type-safe dynamic property write — `value` is tied to `K` so the assignment is checked against EndpointsConfig's actual per-key type. */
function setField<K extends keyof EndpointsConfig>(
  out: EndpointsConfig,
  key: K,
  value: EndpointsConfig[K],
): void {
  out[key] = value;
}

/** Narrows `v` to one of `list`'s literal members — lets mergeEndpoints hand an enum-kind value to setField typechecked. */
function isOneOf<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
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
  for (const spec of ENDPOINT_FIELD_SPECS) {
    const raw = ov[spec.key];
    if (spec.kind === "url") {
      const t = raw.trim();
      if (t !== "" && isValidEndpointUrl(t)) setField(out, spec.key, t);
    } else if (spec.kind === "string") {
      const t = raw.trim();
      if (t !== "") setField(out, spec.key, t);
    } else if (spec.kind === "posInt") {
      if (raw !== "") setField(out, spec.key, Number(raw));
    } else if (spec.kind === "enum" && isOneOf(spec.enum, raw)) {
      setField(out, spec.key, raw);
    }
  }
  return out;
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
    // A non-object is rejected so a corrupted stored value cannot erase in-memory/initial overrides.
    parse: (v) => (isPlainObject(v) ? coerce(v) : null),
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
