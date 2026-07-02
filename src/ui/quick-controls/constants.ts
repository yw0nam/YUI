/** Quick-controls display constants shared by the entry panel + its sub-modules. */
import type { ReasoningEffort } from "../../io/agent-settings";
import type { EndpointOverrides } from "../../io/endpoints-settings";
import type { Locale } from "../i18n";

// 언어 피커 표시 순서(日本語 / English / 한국어). LOCALES와 별개로 고정한다.
export const LANG_PICKER_ORDER: readonly Locale[] = ["ja", "en", "ko"];

// reasoning effort → i18n key for its segment label.
export const SEG_LABEL_KEYS: Record<ReasoningEffort, string> = {
  none: "reasoning.none",
  minimal: "reasoning.minimal",
  low: "reasoning.low",
  medium: "reasoning.medium",
};

// 엔드포인트 섹션: 편집 가능한 5개 필드. url=true면 isValidEndpointUrl 라이브 검증.
// labelKey는 필드 라벨의 i18n 키다.
export interface EndpointFieldDef {
  key: keyof EndpointOverrides;
  labelKey: string;
  url: boolean;
}
export const ENDPOINT_FIELDS: readonly EndpointFieldDef[] = [
  { key: "chat_base_url", labelKey: "endpoints.chat_base_url.label", url: true },
  { key: "stt_base_url", labelKey: "endpoints.stt_base_url.label", url: true },
  { key: "tts_base_url", labelKey: "endpoints.tts_base_url.label", url: true },
  { key: "irodori_base_url", labelKey: "endpoints.irodori_base_url.label", url: true },
  { key: "broker_base_url", labelKey: "endpoints.broker_base_url.label", url: true },
  { key: "chat_model", labelKey: "endpoints.chat_model.label", url: false },
  { key: "tts_voice", labelKey: "endpoints.tts_voice.label", url: false },
];

// 눈 아이콘(보임/숨김). 라인 아이콘 스타일을 다른 아이콘 버튼과 맞춘다.
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

// 탭 아이콘 — 다른 아이콘 버튼과 같은 line 어휘(1.7 stroke, 24x24 viewBox). rail이 접혀도 남는 유일한 단서.
// Input 아이콘은 입력 탭의 voice_input 행 아이콘과 동일 path를 재사용한다.
export const TAB_ICON_TALK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6.8A2.3 2.3 0 0 1 6.3 4.5h11.4A2.3 2.3 0 0 1 20 6.8v6.4a2.3 2.3 0 0 1-2.3 2.3H10l-4.3 3.3v-3.3H6.3A2.3 2.3 0 0 1 4 13.2V6.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
export const TAB_ICON_CHAR = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.3" r="3.1" stroke="currentColor" stroke-width="1.7"/><path d="M5.2 19c1.15-3.4 3.9-5 6.8-5s5.65 1.6 6.8 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const TAB_ICON_INPUT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.5v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 15.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.5 18.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
export const TAB_ICON_ADV = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="6" r="1.7" fill="var(--yui-panel-bg)" stroke="currentColor" stroke-width="1.7"/><circle cx="16" cy="12" r="1.7" fill="var(--yui-panel-bg)" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="18" r="1.7" fill="var(--yui-panel-bg)" stroke="currentColor" stroke-width="1.7"/></svg>`;
export const TAB_ICON_REACT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 3 5.5 13h4.7l-1 8L18 11h-4.7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

// rail 접기/펼치기 쉐브론 — 접히면 CSS가 180도 회전시킨다.
export const RAIL_COLLAPSE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 6l-6 6 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
