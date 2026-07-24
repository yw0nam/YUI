/**
 * Reflect (store→DOM synchronization) layer — reflects all store state onto the panel DOM.
 * Each reflect function reads one section's store and renders it to the corresponding DOM node (switches, sliders, segs, inputs, session readout).
 * DOM nodes are queried directly from deps.root (entry handlers querying the same node yields the same node, so no harm).
 */

import type { createAgentNotifySettings } from "../../io/agent-notify-settings";
import { type createAgentSettings, REASONING_EFFORTS } from "../../io/agent-settings";
import {
  type createEndpointsSettings,
  type EndpointOverrides,
  isValidEndpointUrl,
} from "../../io/endpoints-settings";
import type { createFillerSettings } from "../../io/filler-settings";
import type { createGazeSettings } from "../../io/gaze-settings";
import type { createIdleThrottleSettings } from "../../io/idle-throttle-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../../io/lipsync-settings";
import type { createPresenceSettings } from "../../io/presence-settings";
import type { createRecentAppsSettings } from "../../io/recent-apps-settings";
import type { createScreenshotSettings } from "../../io/screenshot-settings";
import type { createSessionDiagnosticsStore } from "../../io/session-diagnostics";
import type { createTtsSettings } from "../../io/tts-settings";
import { type createVadSettings, VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../../io/vad-settings";
import { getLocale, t } from "../i18n";
import type { VoiceInputStatusSnapshot } from "../voice-input-status";
import {
  CHAT_API_LABEL_KEYS,
  type ChatApi,
  ENDPOINT_FIELDS,
  LANG_PICKER_ORDER,
  VOICE_ENGINE_LABEL_KEYS,
  type VoiceEngine,
} from "./constants";

// Format token count as "18.2K" / "18K" / "200K". Below 1000 stays as-is,
// below 100K shows one decimal (dropping .0), 100K+ shows integer.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}K`;
  return `${k.toFixed(1).replace(/\.0$/, "")}K`;
}

// Toggle invalid state for one URL field (empty value = no error). Shared by reflectEndpoints + endpoint handler.
export function validateEndpointInput(key: keyof EndpointOverrides, input: HTMLInputElement): void {
  const def = ENDPOINT_FIELDS.find((f) => f.key === key)!;
  if (!def.url) return;
  const invalid = !isValidEndpointUrl(input.value);
  const row = input.closest<HTMLDivElement>(".yui-input-row")!;
  row.classList.toggle("is-invalid", invalid);
  input.setAttribute("aria-invalid", invalid ? "true" : "false");
}

interface ReflectDeps {
  /** Panel root (el) — all reflect target nodes are queried from here. */
  root: HTMLElement;
  settings: ReturnType<typeof createScreenshotSettings>;
  idleThrottleSettings: ReturnType<typeof createIdleThrottleSettings>;
  ttsSettings?: ReturnType<typeof createTtsSettings>;
  gazeSettings?: ReturnType<typeof createGazeSettings>;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  lipsync: ReturnType<typeof createLipsyncSettings>;
  vad: ReturnType<typeof createVadSettings>;
  agentSettings: ReturnType<typeof createAgentSettings>;
  fillerSettings?: ReturnType<typeof createFillerSettings>;
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  sessionDiagnostics?: ReturnType<typeof createSessionDiagnosticsStore>;
  /** Per-service API key rows — reflectKeyRows calls reflect() on each row. */
  keyRows: readonly { reflect(): void }[];
  /** Bundled config default endpoints to show as placeholder (undefined if not loaded). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** Bundled config default that effective provider falls back to when no override exists (undefined if not loaded). */
  getDefaultProvider?: () => "openai" | "irodori" | undefined;
  /** Bundled config default that effective chat_api falls back to when no override exists (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  /** Reactions tab numeric inputs — provided when the feature is enabled. */
  agentPortInput?: HTMLInputElement;
  presenceInput?: HTMLInputElement;
  presenceSettings?: ReturnType<typeof createPresenceSettings>;
  recentAppsInput?: HTMLInputElement;
  recentAppsSettings?: ReturnType<typeof createRecentAppsSettings>;
}

export interface Reflect {
  reflectSettings(): void;
  reflectIdleThrottle(): void;
  reflectTts(): void;
  reflectGaze(): void;
  reflectAgentNotify(): void;
  reflectPresence(): void;
  reflectRecentApps(): void;
  reflectGain(): void;
  reflectVad(): void;
  reflectAgent(): void;
  reflectFiller(): void;
  reflectLanguage(): void;
  reflectVoiceEngine(): void;
  reflectChatType(): void;
  reflectEndpoints(): void;
  reflectKeyRows(): void;
  reflectSession(): void;
  reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void;
  /** Effective voice engine (used by reflectVoiceEngine + entry's speakerControlsEnabled). */
  effectiveProvider(): VoiceEngine;
  /** Effective chat API (used by reflectChatType). */
  effectiveChatApi(): ChatApi;
}

export function createReflect(deps: ReflectDeps): Reflect {
  const {
    root,
    settings,
    idleThrottleSettings,
    ttsSettings,
    gazeSettings,
    agentNotifySettings,
    lipsync,
    vad,
    agentSettings,
    fillerSettings,
    endpointsSettings,
    sessionDiagnostics,
    keyRows,
    getEndpointDefaults,
    getDefaultProvider,
    getDefaultChatApi,
    agentPortInput,
    presenceInput,
    presenceSettings,
    recentAppsInput,
    recentAppsSettings,
  } = deps;

  const switchBtn = root.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const idleThrottleSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
  const gazeSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-gaze-switch");
  const agentNotifySwitchBtn = root.querySelector<HTMLButtonElement>(".yui-agentnotify-switch");
  const voiceSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const ttsSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-tts-switch");
  const gainSlider = root.querySelector<HTMLInputElement>(
    ".yui-gain__slider:not(.yui-vad__slider)",
  )!;
  const gainValue = root.querySelector<HTMLSpanElement>(".yui-gain__value:not(.yui-vad__value)")!;
  const vadSlider = root.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const vadValue = root.querySelector<HTMLSpanElement>(".yui-vad__value")!;
  const bargeInSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-bargein-switch");
  const segEl = root.querySelector<HTMLDivElement>(".yui-field-row .yui-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const ttsTypeEl = root.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  const ttsIrodoriEl = root.querySelector<HTMLDivElement>(".yui-tts-irodori")!;
  const ttsOpenaiEl = root.querySelector<HTMLDivElement>(".yui-tts-openai")!;
  const ttsSummaryHintEl = root.querySelector<HTMLSpanElement>(".yui-tts-summary-hint")!;
  const chatTypeEl = root.querySelector<HTMLSelectElement>(".yui-chat-type")!;
  const chatSummaryHintEl = root.querySelector<HTMLSpanElement>(".yui-chat-summary-hint")!;
  const spkScrollEl = root.querySelector<HTMLDivElement>(".yui-spk-scroll")!;
  const spkFootEl = root.querySelector<HTMLDivElement>(".yui-spk-foot")!;
  const spksHintEl = root.querySelector<HTMLParagraphElement>(".yui-spks-hint")!;
  const instructionsEl = root.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const fillerSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-filler-switch");
  const fillerLangSegEl = root.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const fillerLangBtns = fillerLangSegEl
    ? Array.from(fillerLangSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];
  const fillerFirstTextareaEl = root.querySelector<HTMLTextAreaElement>(
    ".yui-filler-first-textarea",
  );
  const fillerRepeatTextareaEl = root.querySelector<HTMLTextAreaElement>(
    ".yui-filler-repeat-textarea",
  );
  const langSegEl = root.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    epInputs.set(key, root.querySelector<HTMLInputElement>(`#yui-ep-${key}`)!);
  }
  const sessionStatEl = root.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = root.querySelector<HTMLSpanElement>(".yui-session__value");

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    root.classList.toggle("is-on", on);
  }

  function reflectIdleThrottle(): void {
    idleThrottleSwitchBtn.setAttribute("aria-checked", String(idleThrottleSettings.get().enabled));
  }

  function reflectTts(): void {
    if (!ttsSwitchBtn || !ttsSettings) return;
    ttsSwitchBtn.setAttribute("aria-checked", String(ttsSettings.get().enabled));
  }

  function reflectGaze(): void {
    if (!gazeSwitchBtn || !gazeSettings) return;
    gazeSwitchBtn.setAttribute("aria-checked", String(gazeSettings.get().enabled));
  }

  function reflectAgentNotify(): void {
    if (!agentNotifySwitchBtn || !agentNotifySettings) return;
    agentNotifySwitchBtn.setAttribute("aria-checked", String(agentNotifySettings.get().enabled));
    if (agentPortInput) agentPortInput.value = String(agentNotifySettings.get().port);
  }

  function reflectPresence(): void {
    if (!presenceInput || !presenceSettings) return;
    presenceInput.value = String(presenceSettings.get().present_max_idle_ms / 1000);
  }

  function reflectRecentApps(): void {
    if (!recentAppsInput || !recentAppsSettings) return;
    recentAppsInput.value = String(recentAppsSettings.get().recent_apps_max);
  }

  function reflectGain(): void {
    const gain = lipsync.get().gain;
    gainSlider.value = String(gain);
    gainValue.textContent = `${gain.toFixed(1)}×`;
    gainSlider.style.setProperty(
      "--fill",
      String((gain - LIPSYNC_GAIN_MIN) / (LIPSYNC_GAIN_MAX - LIPSYNC_GAIN_MIN)),
    );
  }

  function reflectVad(): void {
    const ms = vad.get().silenceMs;
    vadSlider.value = String(ms);
    vadValue.textContent = `${ms} ms`;
    vadSlider.style.setProperty(
      "--fill",
      String((ms - VAD_SILENCE_MIN) / (VAD_SILENCE_MAX - VAD_SILENCE_MIN)),
    );
    bargeInSwitchBtn?.setAttribute("aria-checked", String(vad.get().bargeIn));
  }

  function reflectAgent(): void {
    const a = agentSettings.get();
    const idx = Math.max(0, REASONING_EFFORTS.indexOf(a.reasoning_effort));
    segButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    segEl.style.setProperty("--seg", String(idx));
    // Do not overwrite textarea while typing (remote changes apply on blur).
    if (document.activeElement !== instructionsEl && instructionsEl.value !== a.instructions) {
      instructionsEl.value = a.instructions;
    }
  }

  // Thinking filler section — reflects store state onto UI.
  function reflectFiller(): void {
    if (
      !fillerSettings ||
      !fillerSwitchBtn ||
      !fillerLangSegEl ||
      !fillerFirstTextareaEl ||
      !fillerRepeatTextareaEl
    )
      return;
    const s = fillerSettings.get();
    fillerSwitchBtn.setAttribute("aria-checked", String(s.enabled));
    // Language seg indicator
    const FILLER_LANGS = ["ja", "en", "ko"] as const;
    const idx = Math.max(0, FILLER_LANGS.indexOf(s.language));
    fillerLangBtns.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    fillerLangSegEl.style.setProperty("--seg", String(idx));
    // Two textareas — show current language's customPool (first/repeat) line by line (empty if not set).
    const pool = s.customPools[s.language];
    fillerFirstTextareaEl.value = pool ? pool.first.join("\n") : "";
    fillerRepeatTextareaEl.value = pool ? pool.repeat.join("\n") : "";
  }

  // Language picker — reflects current display language onto selected seg.
  function reflectLanguage(): void {
    const idx = Math.max(0, LANG_PICKER_ORDER.indexOf(getLocale()));
    langSegButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    langSegEl.style.setProperty("--seg", String(idx));
  }

  // Effective voice engine — use valid override if present, else bundled default, else fall back to irodori.
  function effectiveProvider(): VoiceEngine {
    const ov = endpointsSettings.get().tts_provider;
    if (ov === "irodori" || ov === "openai") return ov;
    const def = getDefaultProvider?.();
    return def === "openai" ? "openai" : "irodori";
  }

  // TTS dropdown value + irodori/openai subview display + speaker enable/disable, matching effective provider.
  function reflectVoiceEngine(): void {
    const eff = effectiveProvider();
    if (ttsTypeEl.value !== eff) ttsTypeEl.value = eff;
    const openai = eff === "openai";
    ttsIrodoriEl.hidden = openai;
    ttsOpenaiEl.hidden = !openai;
    ttsSummaryHintEl.textContent = t(VOICE_ENGINE_LABEL_KEYS[eff]);
    // OpenAI uses server voice, so disable speaker selection + show hint (speaker is in irodori subview).
    spkScrollEl.classList.toggle("is-disabled", openai);
    spkFootEl.classList.toggle("is-disabled", openai);
    spksHintEl.hidden = !openai;
  }

  // Effective chat API — use valid override if present, else bundled default, else fall back to responses.
  function effectiveChatApi(): ChatApi {
    const ov = endpointsSettings.get().chat_api;
    if (ov === "responses" || ov === "chat_completions") return ov;
    const def = getDefaultChatApi?.();
    return def === "chat_completions" ? "chat_completions" : "responses";
  }

  // Chat API dropdown value + summary hint, matching effective chat_api (no subview).
  function reflectChatType(): void {
    const eff = effectiveChatApi();
    if (chatTypeEl.value !== eff) chatTypeEl.value = eff;
    chatSummaryHintEl.textContent = t(CHAT_API_LABEL_KEYS[eff]);
  }

  function reflectEndpoints(): void {
    const ov = endpointsSettings.get();
    // Placeholders fill after config loads (panel created before), so refresh every reflect.
    const defaults = getEndpointDefaults?.();
    for (const { key } of ENDPOINT_FIELDS) {
      const input = epInputs.get(key)!;
      if (defaults) input.placeholder = defaults[key];
      // Do not overwrite while typing (remote changes apply on blur).
      if (document.activeElement !== input && input.value !== ov[key]) {
        input.value = ov[key];
      }
      validateEndpointInput(key, input);
    }
  }

  // Render all per-service key rows from store (chat/stt/tts). Values are secret — not logged.
  function reflectKeyRows(): void {
    for (const r of keyRows) r.reflect();
  }

  // Render session diagnostics readout from store. If contextWindow is null, show usage only (no bar/percent).
  function reflectSession(): void {
    if (!sessionDiagnostics || !sessionValueEl) return;
    const d = sessionDiagnostics.get();

    // Context usage + slim bar.
    const used = d.usedTokens;
    const max = d.contextWindow;
    sessionValueEl.textContent = "";
    if (used === null) {
      sessionValueEl.textContent = "—";
    } else if (max === null || max <= 0) {
      sessionValueEl.textContent = formatTokenCount(used);
    } else {
      const pct = Math.min(100, Math.round((used / max) * 100));
      sessionValueEl.append(`${formatTokenCount(used)} / ${formatTokenCount(max)}`);
      const pctEl = document.createElement("span");
      pctEl.className = "pct";
      pctEl.textContent = `${pct}%`;
      sessionValueEl.append(pctEl);
    }
    // Render bar only when contextWindow is known.
    const hasMeter = used !== null && max !== null && max > 0;
    let meter = sessionStatEl?.querySelector<HTMLDivElement>(".yui-meter") ?? null;
    if (hasMeter) {
      const pct = Math.min(100, Math.round((used! / max!) * 100));
      if (!meter) {
        meter = document.createElement("div");
        meter.className = "yui-meter";
        meter.innerHTML = `<div class="yui-meter__fill"></div>`;
        sessionStatEl?.append(meter);
      }
      const fill = meter.querySelector<HTMLDivElement>(".yui-meter__fill")!;
      fill.style.width = `${pct}%`;
      fill.classList.toggle("is-high", pct >= 85);
    } else if (meter) {
      meter.remove();
    }
  }

  function reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void {
    const on = snapshot.state !== "idle";
    voiceSwitchBtn.setAttribute("aria-checked", String(on));
    root.classList.toggle("is-voice-on", on);
  }

  return {
    reflectSettings,
    reflectIdleThrottle,
    reflectAgentNotify,
    reflectPresence,
    reflectRecentApps,
    reflectTts,
    reflectGaze,
    reflectGain,
    reflectVad,
    reflectAgent,
    reflectFiller,
    reflectLanguage,
    reflectVoiceEngine,
    reflectChatType,
    reflectEndpoints,
    reflectKeyRows,
    reflectSession,
    reflectVoiceStatus,
    effectiveProvider,
    effectiveChatApi,
  };
}
