/** Quick-controls display constants shared by the entry panel + its sub-modules. */
import type { TtsProviderName } from "../../contract";
import type { ReasoningEffort } from "../../settings/backend/agent-settings";
import {
  ENDPOINT_FIELD_SPECS,
  type EndpointOverrides,
} from "../../settings/backend/endpoints-settings";
import type { RateLimitOverrides } from "../../settings/backend/guardrails-settings";
import {
  SCREEN_RECENT_CAP_MAX,
  type ScreenOverrides,
} from "../../settings/capture/screen-settings";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import type { Locale } from "../i18n";

export const DEFAULT_PAGE: SettingsPage = "persona";

/** The page the panel opens on. */
export const initialPageOf = (openOnQuickStart: boolean): SettingsPage =>
  openOnQuickStart ? "conn" : DEFAULT_PAGE;

// Language picker display order (Japanese / English / Korean). Fixed independently of LOCALES.
export const LANG_PICKER_ORDER: readonly Locale[] = ["ja", "en", "ko"];

// reasoning effort → i18n key for its segment label.
export const SEG_LABEL_KEYS: Record<ReasoningEffort, string> = {
  default: "reasoning.default",
  none: "reasoning.none",
  minimal: "reasoning.minimal",
  low: "reasoning.low",
  medium: "reasoning.medium",
};

// Endpoints section: text-input fields, derived from io/endpoints-settings's ENDPOINT_FIELD_SPECS
// (url/string-kind rows only — enum/posInt-kind fields render as a dropdown or devtools input
// elsewhere, not as a labeled text row here). If url=true, live validation with isValidEndpointUrl.
interface EndpointFieldDef {
  key: keyof EndpointOverrides;
  labelKey: string;
  url: boolean;
}
const isTextFieldSpec = (
  s: (typeof ENDPOINT_FIELD_SPECS)[number],
): s is Extract<(typeof ENDPOINT_FIELD_SPECS)[number], { kind: "url" | "string" }> =>
  s.kind === "url" || s.kind === "string";

export const ENDPOINT_FIELDS: readonly EndpointFieldDef[] = ENDPOINT_FIELD_SPECS.filter(
  isTextFieldSpec,
).map((s) => ({ key: s.key, labelKey: s.labelKey, url: s.kind === "url" }));

// Proactive and Together pages: the editable rolling-window caps (io/guardrails-settings's RateLimitOverrides).
// Each row renders as a numeric input; an empty field means "no override, use the config default".
export interface RateLimitFieldDef {
  key: keyof RateLimitOverrides;
  id: string;
  labelKey: string;
  subKey: string;
}

/** The caps on the Proactive page, speaking up first. */
export const PROACTIVE_CAP_FIELDS: readonly RateLimitFieldDef[] = [
  {
    key: "tier2_max",
    id: "yui-rate-tier2",
    labelKey: "reactions.rate_tier2_label",
    subKey: "reactions.rate_tier2_sub",
  },
  {
    key: "urgent_max",
    id: "yui-rate-urgent",
    labelKey: "reactions.rate_urgent_label",
    subKey: "reactions.rate_urgent_sub",
  },
];

/** The chain cap governs characters addressing each other, so it sits on the Together page. */
export const CHAIN_CAP_FIELD: RateLimitFieldDef = {
  key: "addressed_chain_max",
  id: "yui-rate-addressed",
  labelKey: "reactions.rate_addressed_label",
  subKey: "reactions.rate_addressed_sub",
};

/** The Proactive page's wait after a conversation, shown in minutes. */
export const PACER_GAP_UNIT = { unitMs: 60_000, suffixKey: "reactions.minutes_suffix" } as const;

// Proactive tab, screen-watch section: the editable configs/screen.json thresholds
// (io/screen-settings's ScreenOverrides). Each renders as a numeric row in its own display unit.
// Clearing a field clears the override,
// and the row then shows the config default. min/max bound both the spinner and the commit.
export interface ScreenKnobFieldDef {
  key: keyof ScreenOverrides;
  id: string;
  labelKey: string;
  subKey: string;
  suffixKey: string;
  /** Display unit → milliseconds. */
  unitMs: number;
  min: number;
  max: number;
}

export const SCREEN_KNOB_FIELDS: readonly ScreenKnobFieldDef[] = [
  {
    key: "prev_dwell_ms",
    id: "yui-screen-prev-dwell",
    labelKey: "screen.prev_dwell_label",
    subKey: "screen.prev_dwell_sub",
    suffixKey: "screen.minutes_suffix",
    unitMs: 60_000,
    min: 1,
    max: 240,
  },
  {
    key: "settle_ms",
    id: "yui-screen-settle",
    labelKey: "screen.settle_label",
    subKey: "screen.settle_sub",
    suffixKey: "screen.seconds_suffix",
    unitMs: 1_000,
    min: 5,
    max: 600,
  },
  {
    key: "long_session_ms",
    id: "yui-screen-long-session",
    labelKey: "screen.long_session_label",
    subKey: "screen.long_session_sub",
    suffixKey: "screen.minutes_suffix",
    unitMs: 60_000,
    min: 5,
    max: 480,
  },
  // recent_cap is a bare count, not a duration — unitMs 1 makes the shared ms<->display-unit
  // conversion a no-op. Row min is 0, but 0 is also the store's "no override" sentinel, so
  // committing 0 here falls back to the config default cap rather than setting a literal 0;
  // configs/screen.json can still express a real 0.
  {
    key: "recent_cap",
    id: "yui-screen-recent-cap",
    labelKey: "screen.recent_cap_label",
    subKey: "screen.recent_cap_sub",
    suffixKey: "screen.count_suffix",
    unitMs: 1,
    min: 0,
    max: SCREEN_RECENT_CAP_MAX,
  },
];

// Eye icon (show/hide). Line-icon style matches other icon buttons.
export const CHATKEY_EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.5"/></svg>`;
export const CHATKEY_EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.6 5.9A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a16 16 0 0 1-2.7 3.3M6.3 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 2.7-.4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.7 9.8a2.6 2.6 0 0 0 3.6 3.7" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
export const CHATKEY_CLEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// Cross icon for delete / error buttons, 2px stroke.
export const CROSS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// Option order of the chat type list.
export const CHAT_APIS = ["chat_completions", "responses", "push"] as const;
export type ChatApi = (typeof CHAT_APIS)[number];

// The cards guide the Card section's ? button opens. The settings window's opener grant names the same URL.
export const CARD_GUIDE_URL = "https://yw0nam.github.io/YUI/guide/cards";
export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
// The voice step's key page. The settings window's opener grant names the same URL.
export const FISH_KEY_URL = "https://fish.audio/app/api-keys/";
// The VRM section's VRoid Hub link. The settings window's opener grant names the same URL.
export const VROID_HUB_URL = "https://hub.vroid.com/en/users/36144806";

// Chat provider presets (Connection tab, chat section) — selecting one autofills chat_base_url with the
// provider's OpenAI-compatible path, the chat_model, the chat protocol, or a combination. Brand names
// are display-as-is, never localized. "custom" is the no-autofill entry the dropdown falls back to when
// nothing matches.
export const CHAT_PRESET_CUSTOM = "custom";
interface ChatProviderPreset {
  id: string;
  name: string;
  /** Autofilled chat_base_url. Absent where the address is the user's own deployment. */
  url?: string;
  /** Autofilled chat_model. Absent where the user picks the model. */
  model?: string;
  /** Protocol the provider speaks. Absent where the provider speaks the current one. */
  chatApi?: ChatApi;
}
/** The chat provider preset Quick start connects. */
export const GEMINI_PRESET = {
  id: "gemini",
  name: "Google Gemini",
  url: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "models/gemini-3.5-flash-lite",
} satisfies ChatProviderPreset;
export const CHAT_PROVIDER_PRESETS: readonly ChatProviderPreset[] = [
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1" },
  { id: "ollama", name: "Ollama", url: "http://localhost:11434/v1" },
  { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234/v1" },
  { id: "groq", name: "Groq", url: "https://api.groq.com/openai/v1" },
  GEMINI_PRESET,
  { id: "hermes", name: "Hermes Agent", chatApi: "push" },
];

// TTS provider presets (Connection tab, TTS section) — selecting one sets tts_provider and autofills
// tts_base_url and tts_model. Brand names are display-as-is, never localized. Only providers with a
// synth are listed.
interface TtsProviderPreset {
  id: TtsProviderName;
  name: string;
  url: string;
  model: string;
}
/** The TTS provider preset Quick start's voice step turns on. */
export const FISH_PRESET = {
  id: "fish",
  name: "Fish Audio",
  url: "https://api.fish.audio",
  model: "s2.1-pro-free",
} satisfies TtsProviderPreset;
export const TTS_PROVIDER_PRESETS: readonly TtsProviderPreset[] = [
  { id: "irodori", name: "Irodori", url: "http://localhost:8088", model: "irodori-tts" },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com", model: "gpt-4o-mini-tts" },
  FISH_PRESET,
];

// STT language suggestions; "auto" omits `language` from the request, and any other ISO-639-1 code can be typed.
export const STT_LANGUAGE_SUGGESTIONS = [
  { value: "auto", labelKey: "endpoints.stt_language.auto" },
  { value: "en", labelKey: "endpoints.stt_language.en" },
  { value: "ja", labelKey: "endpoints.stt_language.ja" },
] as const;

// Session-row disclosure chevron — CSS rotates it 90° when the session is open. Drawn at 14px:
// under the 0.9rem line of the 1.5-stroke icons, so it carries the heavier stroke.
export const HIST_CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
