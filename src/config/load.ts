/**
 * Config loader — configs/*.json loader + validation.
 *
 * config-driven principle: never hardcode API endpoints / models / VRM paths / motion sets.
 * In the OSS phase, API keys live in the OS keychain (Tauri secure storage) rather than plaintext config.
 *
 * Load targets (configs/ at the YUI root; vite dev serves them under `/configs/*`):
 *  - endpoints.json          → EndpointsConfig (chat/stt/tts base url + chat endpoint)
 *  - avatar.json             → AvatarConfig (vrm_url)
 *  - emotion_registry.json   → EmotionRegistry (emotion id → vrm_expression + fallback)
 *  - motions.json            → MotionRegistry (id → vrma_path + playback policy)
 *
 * This file does pure load + validation only (no side effects, reader injectable → testable). Hot-reload/
 * subscription is layered on by store.ts (createConfigStore), which wraps this loadConfig.
 *
 * The agreed contract is split into per-domain files. The implementation follows those split files.
 */

import type { EmotionRegistry, EndpointsConfig, MotionRegistry } from "../contract";
import { resolveAssetUrl } from "../io/asset-url";
import { validateAvatar } from "./validators/avatar";
import { validateEmotionRegistry } from "./validators/emotion-registry";
import { validateEndpoints } from "./validators/endpoints";
import { validateFiller } from "./validators/filler";
import { validateGuardrails } from "./validators/guardrails";
import { validateHotkeys } from "./validators/hotkeys";
import { validateMotions } from "./validators/motions";
import { ConfigError } from "./validators/shared";

export { ConfigError } from "./validators/shared";

/** Logical path → runtime URL resolver. dev = identity, Tauri = absolute bundled-resource URL. */
export type AssetUrlResolver = (logicalPath: string) => Promise<string>;

// ─────────────────────────────────────────────────────────────────────────────
// Config types (contract-derived + loader-only)
// ─────────────────────────────────────────────────────────────────────────────

/** A single selectable VRM (model-swap manifest entry). */
export interface AvatarOption {
  /** Stable key (e.g. "carlotta"). Used to persist selection state. */
  id: string;
  /** Display name (e.g. "Carlotta"). */
  label: string;
  /** Same meaning as vrm_url — vite path or absolute URL. */
  url: string;
  /** "user" = imported via the OS file picker, "file" = external path declared in the config file. Unknown when unset. */
  source?: "bundled" | "file" | "user";
}

export interface TapConfig {
  spam_count: number;
  spam_window_ms: number;
  region_radius_frac: number;
  region_motions: { chest: string; hips: string };
  bored_cue: { label: string; context: string };
}

/** configs/avatar.json — VRM to load (renderer input). */
export interface AvatarConfig {
  /** vite dev static-serving path (`/vrms/*.vrm`) or absolute URL. Default selection. */
  vrm_url: string;
  /** List of selectable VRMs. Absent → vrm_url is the single model. */
  available?: AvatarOption[];
  /** Full-body fit-to-bounds camera knob. Absent → renderer default. */
  framing?: { margin?: number; fov?: number };
  /** Click-through hit-test knob. Absent → controller default. */
  hit_test?: {
    hysteresis_margin_px?: number;
    poll_interval_ms?: number;
    debounce_samples?: number;
    /** alpha threshold for phase-2 (currently unused, only the (0,1] range is validated). */
    alpha_threshold?: number;
  };
  /** Tap reaction knobs. Defaults are applied by the validator. */
  tap: TapConfig;
  /** Camera gaze-tracking knob. Absent → renderer default (natural preset). Partial values allowed. */
  gaze?: {
    deadDeg?: number;
    headEngageDeg?: number;
    disengageDeg?: number;
    maxHeadYaw?: number;
    maxHeadPitch?: number;
    eyeMaxDeg?: number;
    headNeckSplit?: number;
    smooth?: number;
  };
}

/** configs/guardrails.json — DND/debounce/rate-limit values. */
export interface GuardrailsConfig {
  /** DND. */
  dnd: {
    /** active-app blocklist — DND on when a listed app is in the foreground. */
    app_blocklist: string[];
  };
  /** per-source debounce window (ms). 0 = no debounce. */
  debounce_ms: {
    idle_watcher: number;
    os_event_watcher: number;
    backend_push_source: number;
    user_input_source: number;
  };
  /** rolling rate-limit. */
  rate_limit: {
    /** rolling window length (ms). */
    window_ms: number;
    /** tier2 cap. */
    tier2_max: number;
    /** tier3 cap. */
    tier3_max: number;
    /** overall cap on backend calls — entering cooldown when exceeded. */
    overall_max: number;
    /** cooldown duration (ms) after overall is exceeded. */
    cooldown_ms: number;
  };
}

/** TTFT filler language — closed union, never crosses the Hermes wire. */
export type FillerLang = "ja" | "en" | "ko";

/** Per-language filler phrase pool split into two tiers. */
export interface FillerPool {
  /** Phrases for the first filler utterance (immediate acknowledgment). */
  first: string[];
  /** Phrases for subsequent filler utterances (still-thinking backchannels). */
  repeat: string[];
}

/** configs/filler.json — TTFT filler phrases + loop timing. */
export interface FillerConfig {
  /** Silence (ms) between filler utterances — base. */
  gap_ms: number;
  /** Random ± jitter (ms) added to gap_ms each repeat. */
  gap_jitter_ms: number;
  /** Per-language filler phrase pools. */
  pools: Partial<Record<FillerLang, FillerPool>>;
}

/** configs/hotkeys.json — OS global-hotkey accelerators. */
export interface HotkeysConfig {
  /** Global summon input (e.g. "CmdOrCtrl+Shift+Y"). Empty string / no key = disabled. */
  summon_global: string;
}

/** Full loaded and validated config bundle (immutable snapshot). */
export interface AppConfig {
  endpoints: EndpointsConfig;
  avatar: AvatarConfig;
  emotionRegistry: EmotionRegistry;
  motions: MotionRegistry;
  guardrails: GuardrailsConfig;
  filler: FillerConfig;
  hotkeys: HotkeysConfig;
}

/** AppConfig domain keys — the unit hot-reload uses to notify "what changed" (store.ts). */
export type ConfigSection = keyof AppConfig;

/** configs/ files that loadConfig fetches (section → filename). */
export const CONFIG_FILES: Record<ConfigSection, string> = {
  endpoints: "endpoints.json",
  avatar: "avatar.json",
  emotionRegistry: "emotion_registry.json",
  motions: "motions.json",
  guardrails: "guardrails.json",
  filler: "filler.json",
  hotkeys: "hotkeys.json",
};

// ─────────────────────────────────────────────────────────────────────────────
// API-key abstraction (migration layer toward the OS keychain at OSS entry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Secret (e.g. chat api_key) lookup abstraction. Swap between plaintext (plainSecretProvider)
 * and a Tauri secure storage / OS keychain implementation **without changing call sites**.
 * The async signature is there to accommodate keychain access (IPC) up front.
 */
export interface SecretProvider {
  /** undefined when absent. Never throws (a missing key is normal — local Hermes is unauthenticated). */
  get(key: string): Promise<string | undefined>;
}

/**
 * Name used to look up the Hermes chat key in the SecretProvider. Corresponds to backend env `API_SERVER_KEY`.
 * Call site (dispatcher): `streamChat(ep, req, { apiKey: await secrets.get(CHAT_API_KEY_SECRET) })`.
 * (Kept here rather than in chat-client — the secret name is config/SecretProvider's concern, unrelated to the openai SDK.)
 */
export const CHAT_API_KEY_SECRET = "chat_api_key";

/** SecretProvider name for the STT server key (OpenAI-compatible Bearer). */
export const STT_API_KEY_SECRET = "stt_api_key";

/** SecretProvider name for the OpenAI-compatible TTS server key (Bearer). irodori needs none. */
export const TTS_API_KEY_SECRET = "tts_api_key";

/** Looks up from a plaintext record. Real values are best kept out of configs (env/keychain). */
export function plainSecretProvider(
  secrets: Record<string, string | undefined> = {},
): SecretProvider {
  return {
    async get(key) {
      return secrets[key];
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads and parses one file's raw JSON. path is the filename (e.g. "endpoints.json").
 * The default implementation is fetch(`<baseUrl>/<file>`); tests inject a fake reader.
 */
export type ConfigReader = (file: string) => Promise<unknown>;

export interface LoadConfigOptions {
  /** File reader injection (tests). Defaults to the fetch-based reader when unset. */
  read?: ConfigReader;
  /** Prefix the default reader prepends. default `/configs`. */
  baseUrl?: string;
  /** Cache-busting query (passed by the store on hot-reload refetch). */
  cacheBust?: string;
  /** Logical path → runtime URL resolver (injectable). Defaults to resolveAssetUrl (dev passthrough / Tauri bundle). */
  resolveUrl?: AssetUrlResolver;
  /** fetch injection (tests). Defaults to globalThis.fetch when unset. */
  fetch?: typeof fetch;
}

/** Default fetch-based reader (browser/Tauri webview runtime). */
function fetchReader(
  baseUrl: string,
  cacheBust?: string,
  resolveUrl: AssetUrlResolver = resolveAssetUrl,
  fetchImpl: typeof fetch = globalThis.fetch,
): ConfigReader {
  return async (file) => {
    const q = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : "";
    const url = await resolveUrl(`${baseUrl}/${file}${q}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// loadConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads all configs/*.json and assembles a validated AppConfig.
 * Any missing file or schema violation fails immediately with ConfigError (fail-loud, no partial load).
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<AppConfig> {
  const read =
    opts.read ??
    fetchReader(opts.baseUrl ?? "/configs", opts.cacheBust, opts.resolveUrl, opts.fetch);

  // Per-file reads run in parallel; validation runs in deterministic order.
  const [
    endpointsRaw,
    avatarRaw,
    emotionRegistryRaw,
    motionsRaw,
    guardrailsRaw,
    fillerRaw,
    hotkeysRaw,
  ] = await Promise.all([
    read(CONFIG_FILES.endpoints),
    read(CONFIG_FILES.avatar),
    read(CONFIG_FILES.emotionRegistry),
    read(CONFIG_FILES.motions),
    read(CONFIG_FILES.guardrails),
    read(CONFIG_FILES.filler),
    read(CONFIG_FILES.hotkeys),
  ]);

  return {
    endpoints: validateEndpoints(CONFIG_FILES.endpoints, endpointsRaw),
    avatar: validateAvatar(CONFIG_FILES.avatar, avatarRaw),
    emotionRegistry: validateEmotionRegistry(CONFIG_FILES.emotionRegistry, emotionRegistryRaw),
    motions: validateMotions(CONFIG_FILES.motions, motionsRaw),
    guardrails: validateGuardrails(CONFIG_FILES.guardrails, guardrailsRaw),
    filler: validateFiller(CONFIG_FILES.filler, fillerRaw),
    hotkeys: validateHotkeys(CONFIG_FILES.hotkeys, hotkeysRaw),
  };
}
