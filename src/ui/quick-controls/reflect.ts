/**
 * Reflect (store→DOM synchronization) layer — reflects all store state onto the panel DOM.
 * Each reflect function reads one section's store and renders it to the corresponding DOM node (switches, sliders, segs, inputs, session readout).
 * DOM nodes are queried directly from deps.root (entry handlers querying the same node yields the same node, so no harm).
 * The Connection tab reflects its own endpoints; this layer covers the rest of the panel.
 */

import type { DelegationItem, PushSocketState } from "../../io/chat/push-socket";
import type { createSessionDiagnosticsStore } from "../../io/chat/session-diagnostics";
import type { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { type createAgentSettings, REASONING_EFFORTS } from "../../settings/backend/agent-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitOverrides,
} from "../../settings/backend/guardrails-settings";
import type {
  ScreenKnobSettingsStore,
  ScreenOverrides,
} from "../../settings/capture/screen-settings";
import type { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import type { ClampedIntSettingsStore } from "../../settings/persisted-store";
import {
  type createVadSettings,
  VAD_SILENCE_MAX,
  VAD_SILENCE_MIN,
} from "../../settings/voice/vad-settings";
import { renderDelegationRows } from "../chips/delegation-rows";
import type { VoiceInputStatusSnapshot } from "../chips/voice-input-status";
import { getLocale, t } from "../i18n";
import { reflectUnlessEditing } from "../surfaces/reflect-unless-editing";
import {
  LANG_PICKER_ORDER,
  RATE_LIMIT_FIELDS,
  SCREEN_KNOB_FIELDS,
  SCREEN_MIN_GAP_MAX,
  SCREEN_MIN_GAP_MIN,
  type ScreenKnobFieldDef,
} from "./constants";
import type { SwitchRow } from "./switch-row";
import { reflectSwitchRows } from "./switches/switch-rows";

// Format token count as "18.2K" / "18K" / "200K". Below 1000 stays as-is,
// below 100K shows one decimal (dropping .0), 100K+ shows integer.
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}K`;
  return `${k.toFixed(1).replace(/\.0$/, "")}K`;
}

interface ReflectDeps {
  /** Panel root (el) — all reflect target nodes are queried from here. */
  root: HTMLElement;
  switchRows: readonly SwitchRow[];
  settings: ReturnType<typeof createScreenshotSettings>;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  vad: ReturnType<typeof createVadSettings>;
  agentSettings: ReturnType<typeof createAgentSettings>;
  sessionDiagnostics?: ReturnType<typeof createSessionDiagnosticsStore>;
  /** Push socket state while push chat is the effective mode; undefined otherwise. */
  getPushState?: () => PushSocketState | undefined;
  /** The delegations list the session section renders. Absent where nothing mirrors it. */
  delegations?: {
    get(): DelegationItem[];
    subscribe(cb: (items: DelegationItem[]) => void): () => void;
  };
  presenceSettings?: ClampedIntSettingsStore;
  pacerGapSettings?: ClampedIntSettingsStore;
  rateLimitSettings?: GuardrailsSettingsStore;
  /** Bundled config caps a field falls back to when it carries no override (undefined if not loaded). */
  getRateLimitDefaults?: () => RateLimitOverrides | undefined;
  /** Screen-watch on/off — gates the knob group's visibility. */
  screenSettings?: { get(): { enabled: boolean } };
  screenKnobSettings?: ScreenKnobSettingsStore;
  /** Bundled config thresholds a knob falls back to when it carries no override (undefined if not loaded). */
  getScreenDefaults?: () => ScreenOverrides | undefined;
}

export interface Reflect {
  reflectSettings(): void;
  reflectSwitchRows(): void;
  reflectAgentNotify(): void;
  reflectPresence(): void;
  reflectPacerGap(): void;
  reflectRateLimits(): void;
  reflectScreen(): void;
  reflectVad(): void;
  reflectAgent(): void;
  reflectLanguage(): void;
  reflectSession(): void;
  reflectDelegations(): void;
  reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void;
}

export function createReflect(deps: ReflectDeps): Reflect {
  const {
    root,
    switchRows,
    settings,
    agentNotifySettings,
    vad,
    agentSettings,
    sessionDiagnostics,
    getPushState,
    delegations,
    presenceSettings,
    pacerGapSettings,
    rateLimitSettings,
    getRateLimitDefaults,
    screenSettings,
    screenKnobSettings,
    getScreenDefaults,
  } = deps;

  const switchBtn = root.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const switchSubEl = switchBtn
    .closest(".yui-row")!
    .querySelector<HTMLSpanElement>(".yui-row__sub")!;
  const voiceSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const vadSlider = root.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const vadValue = root.querySelector<HTMLSpanElement>(".yui-vad__value")!;
  const segEl = root.querySelector<HTMLDivElement>(".yui-effort-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const instructionsEl = root.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const langSegEl = root.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const sessionStatEl = root.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = root.querySelector<HTMLSpanElement>(".yui-session__value");
  const sessionDelegEl = root.querySelector<HTMLDivElement>(".yui-session__deleg");
  const sessionDelegRowsEl = root.querySelector<HTMLDivElement>(".yui-session__deleg-rows");
  const sessionDelegLostEl = root.querySelector<HTMLParagraphElement>(".yui-session__deleg-lost");
  const screenKnobsEl = root.querySelector<HTMLDivElement>(".yui-screen-knobs");
  const screenGapSlider = root.querySelector<HTMLInputElement>(".yui-screen-gap__slider");
  const screenGapValue = root.querySelector<HTMLSpanElement>(".yui-screen-gap__value");
  // Screen-watch threshold inputs — map of input nodes by field key (empty when the store is absent).
  const screenKnobInputs = new Map<ScreenKnobFieldDef["key"], HTMLInputElement>();
  for (const field of SCREEN_KNOB_FIELDS) {
    const input = root.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) screenKnobInputs.set(field.key, input);
  }
  // Reactions tab numeric inputs — null or empty when the row is not rendered.
  const agentPortInput = root.querySelector<HTMLInputElement>("#yui-agent-port");
  const presenceInput = root.querySelector<HTMLInputElement>("#yui-presence");
  const pacerGapInput = root.querySelector<HTMLInputElement>("#yui-pacer-gap");
  const rateLimitInputs = new Map<keyof RateLimitOverrides, HTMLInputElement>();
  for (const field of RATE_LIMIT_FIELDS) {
    const input = root.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) rateLimitInputs.set(field.key, input);
  }

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    switchSubEl.textContent = t(on ? "screenshot.foot_on" : "screenshot.foot_off");
    root.classList.toggle("is-on", on);
  }

  const reflectSwitchRowsFromDeps = (): void => reflectSwitchRows(root, switchRows);

  function reflectAgentNotify(): void {
    if (!agentNotifySettings) return;
    if (agentPortInput) agentPortInput.value = String(agentNotifySettings.get().port);
  }

  function reflectPresence(): void {
    if (!presenceInput || !presenceSettings) return;
    const next = String(presenceSettings.get().value / 1000);
    reflectUnlessEditing(presenceInput, next);
  }

  function reflectPacerGap(): void {
    if (!pacerGapInput || !pacerGapSettings) return;
    reflectUnlessEditing(pacerGapInput, String(pacerGapSettings.get().value / 60_000));
  }

  // Each field shows its effective cap: the override when set, the bundled config default otherwise.
  function reflectRateLimits(): void {
    if (!rateLimitSettings) return;
    const overrides = rateLimitSettings.get();
    const defaults = getRateLimitDefaults?.();
    for (const [key, input] of rateLimitInputs) {
      const effective = overrides[key] > 0 ? overrides[key] : (defaults?.[key] ?? 0);
      reflectUnlessEditing(input, effective > 0 ? String(effective) : "");
    }
  }

  // The knob group follows the master toggle; each knob shows its override when set, else the config default.
  function reflectScreen(): void {
    if (!screenKnobsEl || !screenSettings) return;
    screenKnobsEl.hidden = !screenSettings.get().enabled;
    if (!screenKnobSettings) return;
    const overrides = screenKnobSettings.get();
    const defaults = getScreenDefaults?.();
    const effective = (key: keyof ScreenOverrides): number =>
      overrides[key] > 0 ? overrides[key] : (defaults?.[key] ?? 0);
    for (const field of SCREEN_KNOB_FIELDS) {
      const input = screenKnobInputs.get(field.key);
      if (!input) continue;
      const value = effective(field.key);
      reflectUnlessEditing(input, value > 0 ? String(Math.round(value / field.unitMs)) : "");
    }
    if (screenGapSlider && screenGapValue) {
      const minutes = Math.round(effective("min_gap_ms") / 60_000);
      screenGapSlider.value = String(minutes);
      screenGapValue.textContent = t("screen.min_gap_value", { n: minutes });
      screenGapSlider.style.setProperty(
        "--fill",
        String((minutes - SCREEN_MIN_GAP_MIN) / (SCREEN_MIN_GAP_MAX - SCREEN_MIN_GAP_MIN)),
      );
    }
  }

  function reflectVad(): void {
    const ms = vad.get().silenceMs;
    vadSlider.value = String(ms);
    vadValue.textContent = `${ms} ms`;
    vadSlider.style.setProperty(
      "--fill",
      String((ms - VAD_SILENCE_MIN) / (VAD_SILENCE_MAX - VAD_SILENCE_MIN)),
    );
  }

  function reflectAgent(): void {
    const a = agentSettings.get();
    const idx = Math.max(0, REASONING_EFFORTS.indexOf(a.reasoning_effort));
    segButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    // Do not overwrite textarea while typing (remote changes apply on blur).
    if (
      (!document.hasFocus() || document.activeElement !== instructionsEl) &&
      instructionsEl.value !== a.instructions
    ) {
      instructionsEl.value = a.instructions;
    }
  }

  // Language picker — reflects current display language onto selected seg.
  function reflectLanguage(): void {
    const idx = Math.max(0, LANG_PICKER_ORDER.indexOf(getLocale()));
    langSegButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
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

  // The delegated-work list from the history; the lost line joins it while the transport is not ready.
  const openSummaries = new Set<string>();
  function reflectDelegations(): void {
    if (!sessionDelegEl || !sessionDelegRowsEl || !sessionDelegLostEl || !delegations) return;
    const state = getPushState?.();
    const lost = state !== undefined && state.kind !== "ready";
    const items = delegations.get();
    sessionDelegLostEl.hidden = !lost;
    sessionDelegRowsEl.hidden = false;
    sessionDelegEl.hidden = !lost && items.length === 0;
    renderDelegationRows(sessionDelegRowsEl, items, Date.now(), {
      open: openSummaries,
      onToggle: reflectDelegations,
    });
  }

  function reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void {
    const on = snapshot.state !== "idle";
    voiceSwitchBtn.setAttribute("aria-checked", String(on));
    root.classList.toggle("is-voice-on", on);
  }

  return {
    reflectSettings,
    reflectSwitchRows: reflectSwitchRowsFromDeps,
    reflectAgentNotify,
    reflectPresence,
    reflectPacerGap,
    reflectRateLimits,
    reflectScreen,
    reflectVad,
    reflectAgent,
    reflectLanguage,
    reflectSession,
    reflectDelegations,
    reflectVoiceStatus,
  };
}
