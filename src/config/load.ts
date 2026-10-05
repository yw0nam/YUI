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
 *  - screen.json             → ScreenConfig (frontmost-transition detector thresholds)
 *
 * This file does pure load + validation only (no side effects, reader injectable → testable). Hot-reload/
 * subscription is layered on by store.ts (createConfigStore), which wraps this loadConfig.
 *
 * The agreed contract is split into per-domain files. The implementation follows those split files.
 */

import type { EmotionRegistry, EndpointsConfig, MotionRegistry } from "../contract";
import { resolveAssetUrl } from "./asset-url";
import { validateAvatar } from "./validators/avatar";
import type { AvatarConfig } from "./validators/avatar/types";
import { validateEmotionRegistry } from "./validators/emotion-registry";
import { validateEndpoints } from "./validators/endpoints";
import { type FillerConfig, validateFiller } from "./validators/filler";
import { type GuardrailsConfig, validateGuardrails } from "./validators/guardrails";
import { type HotkeysConfig, validateHotkeys } from "./validators/hotkeys";
import { validateMotions } from "./validators/motions";
import { type ScreenConfig, validateScreen } from "./validators/screen";
import { ConfigError } from "./validators/shared";

/** Logical path → runtime URL resolver. dev = identity, Tauri = absolute bundled-resource URL. */
export type AssetUrlResolver = (logicalPath: string) => Promise<string>;

// ─────────────────────────────────────────────────────────────────────────────
// Config types (contract-derived + loader-only)
// ─────────────────────────────────────────────────────────────────────────────

/** Full loaded and validated config bundle (immutable snapshot). */
export interface AppConfig {
  endpoints: EndpointsConfig;
  avatar: AvatarConfig;
  emotionRegistry: EmotionRegistry;
  motions: MotionRegistry;
  guardrails: GuardrailsConfig;
  filler: FillerConfig;
  hotkeys: HotkeysConfig;
  screen: ScreenConfig;
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
  screen: "screen.json",
};

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
export function fetchReader(opts: {
  /** Prefix prepended to every read path. */
  baseUrl: string;
  /** Cache-busting query (passed by the store on hot-reload refetch). */
  cacheBust?: string;
  /** Logical path → runtime URL resolver. Defaults to resolveAssetUrl. */
  resolveUrl?: AssetUrlResolver;
  /** fetch injection (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}): ConfigReader {
  const {
    baseUrl,
    cacheBust,
    resolveUrl = resolveAssetUrl,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;
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
      throw new ConfigError(file, ["response is not JSON"]);
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
    fetchReader({
      baseUrl: opts.baseUrl ?? "/configs",
      cacheBust: opts.cacheBust,
      resolveUrl: opts.resolveUrl,
      fetch: opts.fetch,
    });

  // Per-file reads run in parallel; validation runs in deterministic order.
  const [
    endpointsRaw,
    avatarRaw,
    emotionRegistryRaw,
    motionsRaw,
    guardrailsRaw,
    fillerRaw,
    hotkeysRaw,
    screenRaw,
  ] = await Promise.all([
    read(CONFIG_FILES.endpoints),
    read(CONFIG_FILES.avatar),
    read(CONFIG_FILES.emotionRegistry),
    read(CONFIG_FILES.motions),
    read(CONFIG_FILES.guardrails),
    read(CONFIG_FILES.filler),
    read(CONFIG_FILES.hotkeys),
    read(CONFIG_FILES.screen),
  ]);

  return {
    endpoints: validateEndpoints(CONFIG_FILES.endpoints, endpointsRaw),
    avatar: validateAvatar(CONFIG_FILES.avatar, avatarRaw),
    emotionRegistry: validateEmotionRegistry(CONFIG_FILES.emotionRegistry, emotionRegistryRaw),
    motions: validateMotions(CONFIG_FILES.motions, motionsRaw),
    guardrails: validateGuardrails(CONFIG_FILES.guardrails, guardrailsRaw),
    filler: validateFiller(CONFIG_FILES.filler, fillerRaw),
    hotkeys: validateHotkeys(CONFIG_FILES.hotkeys, hotkeysRaw),
    screen: validateScreen(CONFIG_FILES.screen, screenRaw),
  };
}
