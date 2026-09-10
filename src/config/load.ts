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
import { resolveAssetUrl } from "../io/asset-url";
import { validateAvatar } from "./validators/avatar";
import { validateEmotionRegistry } from "./validators/emotion-registry";
import { validateEndpoints } from "./validators/endpoints";
import { validateFiller } from "./validators/filler";
import { validateGuardrails } from "./validators/guardrails";
import { validateHotkeys } from "./validators/hotkeys";
import { validateMotions } from "./validators/motions";
import { validateScreen } from "./validators/screen";
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
  region_motions: { head: string; chest: string; hips: string };
  bored_cue: { label: string; context?: string };
  /** Emotion applied alongside the region motion. Absent region → motion only. */
  region_emotions?: { head?: string; chest?: string; hips?: string };
  /** Touch speech cue handed to the backend on a region tap. Absent region → no candidate. */
  region_cues?: {
    head?: { label: string; context?: string };
    chest?: { label: string; context?: string };
    hips?: { label: string; context?: string };
  };
  /** Cooldown (ms) shared by all touch speech candidates. */
  touch_cue_cooldown_ms: number;
  /** Hold (ms) before a region-tap emotion eases back to neutral. */
  touch_emotion_hold_ms: number;
  /** Press duration (ms) on the head region before a tap becomes a pat. */
  pat_hold_ms: number;
}

export interface PeekConfig {
  side_out_frac: number;
  side_in_frac: number;
  inset_frac: number;
  mirror_side: "left" | "right" | "none";
}

/** Ambient floor-stroll knobs. Distances and the floor tolerance are logical px. */
export interface WalkConfig {
  /** Shortest gap between stroll attempts. */
  interval_min_ms: number;
  /** Longest gap between stroll attempts. */
  interval_max_ms: number;
  /** Shortest stroll, before work-area clamping. */
  distance_min_px: number;
  /** Longest stroll, before work-area clamping. */
  distance_max_px: number;
  /** How far the window bottom may sit from the work-area bottom and still count as grounded. */
  floor_tolerance_px: number;
}

/** Ambient stroll knobs for a drag-origin window-top perch. */
export interface PerchWalkConfig {
  dwell_min_ms: number;
  dwell_max_ms: number;
  distance_min_px: number;
  distance_max_px: number;
  edge_margin_frac: number;
  /** Height difference within which a neighbouring window top is one ledge with the host's. */
  level_tolerance_px: number;
}

/** Fall dynamics and the surfaces a fall stops on. Distances and speeds are logical px. */
export interface FallConfig {
  /** Downward acceleration while the character falls. */
  gravity_px_s2: number;
  /** Terminal velocity the descent never exceeds. */
  max_speed_px_s: number;
  /** A drop shorter than this fraction of the on-screen character height snaps instead of falling. */
  min_drop_frac: number;
  /** Cooldown (ms) between drop speech candidates. */
  cue_cooldown_ms: number;
  /** Standing room either side of the fall a window top needs to catch it, in character widths. */
  land_room_frac: number;
  /** Chance a perched stroll with no jumpable neighbour walks off the edge instead. */
  step_off_probability: number;
}

export interface DescendConfig {
  /** Chance a stroll on a segment with a descent edge walks to that edge and descends. */
  chance: number;
  /** Chance the descent climbs down the lower screen's edge; otherwise she steps off and falls. */
  climb_down_chance: number;
}

/** Ambient window-climb knobs. Fractions are multiples of the on-screen character height. */
export interface ClimbConfig {
  /** Shortest gap between climb attempts. */
  interval_min_ms: number;
  /** Longest gap between climb attempts. */
  interval_max_ms: number;
  /** Shortest sit before the character climbs back down. */
  perch_dwell_min_ms: number;
  /** Longest sit before the character climbs back down. */
  perch_dwell_max_ms: number;
  /** Tallest climbable window, as a multiple of the character height. */
  max_height_frac: number;
  /** How far the character drops onto the wall during the hang transition. */
  hang_frac: number;
  /**
   * Hand reach off the wall on the way up: how far outside a window's face the character
   * stands to climb it, so the body clears the edge instead of straddling it. Twice this
   * is the width of the column beside the edge that must be clear of windows in front.
   */
  wall_offset_frac: number;
  /** The same reach on the way down; the descent clips hang the body further off the wall. */
  descent_wall_offset_frac: number;
  /** Shortest walk in along the window's top edge before she sits, from the corner. */
  ledge_walk_min_frac: number;
  /** Longest such walk. Clamped at run time to keep the seat on the window. */
  ledge_walk_max_frac: number;
}

/** Window-to-window jump knobs. Height fractions are multiples of the character height. */
export interface JumpConfig {
  /** Chance a planned perch stroll becomes a jump when an eligible neighbour exists. */
  probability: number;
  /** How far above the host's top a neighbour's top may sit and still be reachable. */
  height_up_max_frac: number;
  /** How far below it. */
  height_down_max_frac: number;
  /** Widest gap she will clear, as a multiple of the character's own width. */
  gap_max_width_frac: number;
  /** How far above the higher of the two tops the arc peaks. */
  apex_lift_frac: number;
  /** Point in the clip where the feet leave the host, as a fraction of its length. */
  takeoff_frac: number;
  /** Point in the clip where they reach the neighbour. */
  land_frac: number;
  /**
   * How long a flight may run before it is abandoned. The clip paces the arc, so a clip
   * that never becomes measurable would otherwise leave her hanging for good.
   */
  flight_timeout_ms: number;
}

/** Authored label for one reflex-gesture speech candidate. context is optional user-authored intent. */
export interface GestureCueConfig {
  label: string;
  context?: string;
}

/** Reflex-gesture speech cues — drag-hold / window-sit / peek / drop. */
export interface GestureCuesConfig {
  drag_held: GestureCueConfig;
  window_sit: GestureCueConfig;
  peek: GestureCueConfig;
  dropped: GestureCueConfig;
}

/** Full-body fit-to-bounds camera knob. */
export interface FramingConfig {
  /** Padding around the model bounds, as a fraction of the fitted size. */
  margin: number;
  /** Vertical field of view (degrees) the fit solves against. */
  fov: number;
}

/** Click-through hit-test knob. */
export interface HitTestKnobs {
  /** How far outside the character the cursor may sit and still hold the window interactive. */
  hysteresis_margin_px: number;
  /** Gap between cursor reads while the window is click-through. */
  poll_interval_ms: number;
  /** Agreeing samples needed before the click-through state flips. */
  debounce_samples: number;
  /** Alpha (0, 1] a rendered pixel must reach to count as the character. */
  alpha_threshold: number;
}

/** Cursor gaze-tracking angles (degrees) and damping. */
export interface GazeKnobs {
  /** No tracking within this eccentricity (degrees). */
  deadDeg: number;
  /** Eyes reach full tracking by here; head starts recruiting past it (degrees). */
  headEngageDeg: number;
  /** Beyond this the character disengages — can't crane the neck around (degrees). */
  disengageDeg: number;
  /** Degrees of gaze rotation per window-width of cursor offset from the head's screen position. */
  sensitivity: number;
  /** Max head-bone yaw (degrees). */
  maxHeadYaw: number;
  /** Max head-bone pitch (degrees). */
  maxHeadPitch: number;
  /** Max eye yaw/pitch (degrees). */
  eyeMaxDeg: number;
  /** Fraction of the head rotation taken by the head bone; the rest goes to neck. */
  headNeckSplit: number;
  /** Exponential damping rate (1/s) for k = 1-exp(-smooth·dt). */
  smooth: number;
}

/** configs/avatar.json — VRM to load (renderer input). */
export interface AvatarConfig {
  /** vite dev static-serving path (`/vrms/*.vrm`) or absolute URL. Default selection. */
  vrm_url: string;
  /** List of selectable VRMs. Absent → vrm_url is the single model. */
  available?: AvatarOption[];
  /** Full-body fit-to-bounds camera knob. */
  framing: FramingConfig;
  /** Click-through hit-test knob. */
  hit_test: HitTestKnobs;
  /** Tap reaction knobs. */
  tap: TapConfig;
  /** Side-peek geometry and mirroring knobs. */
  peek: PeekConfig;
  /** Ambient floor-stroll knobs. */
  walk: WalkConfig;
  /** Ambient stroll knobs for a drag-origin window-top perch. */
  perch_walk: PerchWalkConfig;
  /** Drag-release fall knobs. */
  fall: FallConfig;
  /** Upper-to-lower monitor descent choices. */
  descend: DescendConfig;
  /** Ambient window-climb knobs. */
  climb: ClimbConfig;
  /** Window-to-window jump knobs. */
  jump: JumpConfig;
  /** Drag-hold reflex threshold (ms) — proactive.drag_held fires once a drag has been held this long. */
  drag_hold_ms: number;
  /** Reflex-gesture speech cues (drag-hold / window-sit / peek / drop). */
  gesture_cues: GestureCuesConfig;
  /** Cursor gaze-tracking knob. */
  gaze: GazeKnobs;
}

/** Attach-time caps on one turn's image attachments. */
export interface AttachmentLimits {
  /** Max images held for one turn. Further attachments are refused. */
  max_count: number;
  /** Max source-file size (bytes) for one image. Larger files are refused. */
  max_image_bytes: number;
}

/** configs/guardrails.json — debounce/rate-limit values. */
export interface GuardrailsConfig {
  /** per-source debounce window (ms). 0 = no debounce. */
  debounce_ms: {
    os_event_watcher: number;
    user_input_source: number;
    screen_watcher: number;
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
  /** attach-time caps on turn attachments. */
  attachments: AttachmentLimits;
}

/** TTFT filler language — closed union, never crosses the Hermes wire. */
export type FillerLang = "ja" | "en" | "ko";

/** Per-language filler phrase pool, one list per waiting tier. */
export interface FillerPool {
  /** Phrases for the first filler utterance (immediate acknowledgment). */
  first: string[];
  /** Phrases for subsequent filler utterances (still-thinking backchannels). */
  repeat: string[];
  /** Phrase for the single utterance once repeats are exhausted and the wait keeps going. */
  long_wait: string[];
  /** Per-tool_id acknowledgment phrases; `_default` covers an id with no specific entry. */
  tool: Record<string, string[]>;
  /** Phrases spoken when a user turn fails with network_stall. */
  timeout: string[];
  /** Phrases spoken when a user turn fails with network_drop. */
  unreachable: string[];
}

/** configs/filler.json — TTFT filler phrases + loop timing. */
export interface FillerConfig {
  /** Silence (ms) between filler utterances — base. */
  gap_ms: number;
  /** Random ± jitter (ms) added to gap_ms each repeat. */
  gap_jitter_ms: number;
  /** Repeats allowed after the first phrase before falling back to long_wait. */
  max_repeats: number;
  /** Multiplier applied to gap_ms per repeat (exponential backoff). */
  gap_growth: number;
  /** Silence (ms) after the last spoken filler/tool utterance or activity event before the
   * single long_wait phrase fires — once per turn, un-jittered. */
  long_wait_ms: number;
  /** Per-language filler phrase pools. */
  pools: Partial<Record<FillerLang, FillerPool>>;
}

/**
 * configs/screen.json — frontmost-transition detector thresholds (screen-source).
 * All six are surfaced as UI knobs; the client reads them live on every tick.
 */
export interface ScreenConfig {
  /** The departed app must have held the foreground this long for a switch to count. */
  prev_dwell_ms: number;
  /** The new app must hold the foreground this long before the switch fires. */
  settle_ms: number;
  /** One app holding the foreground this long marks a long session, re-marking each period. */
  long_session_ms: number;
  /** Minimum spacing between screen fires. */
  min_gap_ms: number;
  /** No screen fire within this long of a backend turn from any producer. */
  quiet_after_turn_ms: number;
  /** Max app_switched transitions held during a pacer gap; oldest dropped on overflow. 0 = accumulate nothing. */
  recent_cap: number;
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

/** SecretProvider name for the TTS server key (Bearer). Only needed by servers that require one. */
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
