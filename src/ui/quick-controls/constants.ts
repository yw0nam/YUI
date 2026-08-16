/** Quick-controls display constants shared by the entry panel + its sub-modules. */
import type { ReasoningEffort } from "../../io/agent-settings";
import { ENDPOINT_FIELD_SPECS, type EndpointOverrides } from "../../io/endpoints-settings";
import type { RateLimitOverrides } from "../../io/guardrails-settings";
import type { ScreenOverrides } from "../../io/screen-settings";
import type { Locale } from "../i18n";

// Tab identity — the suffix of each tab button's `yui-tab-*` element id.
// "hist" renders only when a transcript is injected; the rest are always present.
export type QuickControlsTab = "talk" | "char" | "input" | "adv" | "react" | "hist";

// Language picker display order (Japanese / English / Korean). Fixed independently of LOCALES.
export const LANG_PICKER_ORDER: readonly Locale[] = ["ja", "en", "ko"];

// reasoning effort → i18n key for its segment label.
export const SEG_LABEL_KEYS: Record<ReasoningEffort, string> = {
  none: "reasoning.none",
  minimal: "reasoning.minimal",
  low: "reasoning.low",
  medium: "reasoning.medium",
};

// Endpoints section: text-input fields, derived from io/endpoints-settings's ENDPOINT_FIELD_SPECS
// (url/string-kind rows only — enum/posInt-kind fields render as a dropdown or devtools input
// elsewhere, not as a labeled text row here). If url=true, live validation with isValidEndpointUrl.
export interface EndpointFieldDef {
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

// Reactions tab: the editable rolling-window caps (io/guardrails-settings's RateLimitOverrides).
// Each row renders as a numeric input; an empty field means "no override, use the config default".
// tier3_max has no row: classify() never returns tier 3 at the evaluate site, so the cap it would
// edit is never compared.
export interface RateLimitFieldDef {
  key: keyof RateLimitOverrides;
  id: string;
  labelKey: string;
  subKey: string;
}

export const RATE_LIMIT_FIELDS: readonly RateLimitFieldDef[] = [
  {
    key: "tier2_max",
    id: "yui-rate-tier2",
    labelKey: "reactions.rate_tier2_label",
    subKey: "reactions.rate_tier2_sub",
  },
  {
    key: "overall_max",
    id: "yui-rate-overall",
    labelKey: "reactions.rate_overall_label",
    subKey: "reactions.rate_overall_sub",
  },
];

// Proactive tab, screen-watch section: the editable configs/screen.json thresholds
// (io/screen-settings's ScreenOverrides). Each renders as a numeric row in its own display unit;
// min_gap_ms is the slider above them and so has no row. An empty field means "no override".
export interface ScreenKnobFieldDef {
  key: Exclude<keyof ScreenOverrides, "min_gap_ms">;
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
  {
    key: "quiet_after_turn_ms",
    id: "yui-screen-quiet",
    labelKey: "screen.quiet_label",
    subKey: "screen.quiet_sub",
    suffixKey: "screen.minutes_suffix",
    unitMs: 60_000,
    min: 1,
    max: 120,
  },
];

/** Min-gap slider bounds, in minutes. 0 clears the override and restores the config default. */
export const SCREEN_MIN_GAP_MIN = 0;
export const SCREEN_MIN_GAP_MAX = 60;

// Display icon for the screen-watch row — monitor with a lens, matching the line-icon set.
export const SCREEN_WATCH_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
  <path d="M12 16v3.5M8.5 20h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  <circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="1.7"/>
</svg>`;

// Eye icon (show/hide). Line-icon style matches other icon buttons.
export const CHATKEY_EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7"/></svg>`;
export const CHATKEY_EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.6 5.9A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a16 16 0 0 1-2.7 3.3M6.3 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 2.7-.4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.7 9.8a2.6 2.6 0 0 0 3.6 3.7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
export const CHATKEY_CLEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const VOICE_ENGINES = ["irodori", "openai"] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];
// voice engine → i18n key for its segment label.
export const VOICE_ENGINE_LABEL_KEYS: Record<VoiceEngine, string> = {
  irodori: "speaker.engine_irodori",
  openai: "speaker.engine_openai",
};

export const CHAT_APIS = ["responses", "chat_completions"] as const;
export type ChatApi = (typeof CHAT_APIS)[number];
// chat_api → i18n key for its dropdown option / summary hint label.
export const CHAT_API_LABEL_KEYS: Record<ChatApi, string> = {
  responses: "svc.chat_type_responses",
  chat_completions: "svc.chat_type_completions",
};

// Chat provider presets (Advanced tab, chat card) — selecting one autofills chat_base_url with the
// provider's OpenAI-compatible path. Brand names are display-as-is, never localized. "custom" is the
// no-autofill entry the dropdown falls back to when the URL matches no preset.
export const CHAT_PRESET_CUSTOM = "custom";
export interface ChatProviderPreset {
  id: string;
  name: string;
  url: string;
}
export const CHAT_PROVIDER_PRESETS: readonly ChatProviderPreset[] = [
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1" },
  { id: "ollama", name: "Ollama", url: "http://localhost:11434/v1" },
  { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234/v1" },
  { id: "groq", name: "Groq", url: "https://api.groq.com/openai/v1" },
];

// Tab icons — same line-icon vocabulary as other icon buttons (1.7 stroke, 24x24 viewBox). Only clue when rail collapses.
// Input icon reuses the same path as the voice_input row icon in the input tab.
export const TAB_ICON_TALK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6.8A2.3 2.3 0 0 1 6.3 4.5h11.4A2.3 2.3 0 0 1 20 6.8v6.4a2.3 2.3 0 0 1-2.3 2.3H10l-4.3 3.3v-3.3H6.3A2.3 2.3 0 0 1 4 13.2V6.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
export const TAB_ICON_CHAR = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.3" r="3.1" stroke="currentColor" stroke-width="1.7"/><path d="M5.2 19c1.15-3.4 3.9-5 6.8-5s5.65 1.6 6.8 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const TAB_ICON_INPUT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.5v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 15.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.5 18.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
export const TAB_ICON_ADV = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="6" r="1.7" fill="var(--yui-panel-bg)" stroke="currentColor" stroke-width="1.7"/><circle cx="16" cy="12" r="1.7" fill="var(--yui-panel-bg)" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="18" r="1.7" fill="var(--yui-panel-bg)" stroke="currentColor" stroke-width="1.7"/></svg>`;
export const TAB_ICON_REACT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 3 5.5 13h4.7l-1 8L18 11h-4.7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

export const TAB_ICON_HIST = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.5 17v-4h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Session-row disclosure chevron — CSS rotates it 90° when the session is open.
export const HIST_CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// rail collapse/expand chevron — CSS rotates it 180° when collapsed.
export const RAIL_COLLAPSE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 6l-6 6 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
