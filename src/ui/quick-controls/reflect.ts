/**
 * Reflect (store→DOM synchronization) layer — reflects all store state onto the panel DOM.
 * Each reflect function reads one section's store and renders it to the corresponding DOM node (switches, sliders, segs, inputs, session readout).
 * DOM nodes are queried directly from deps.root (entry handlers querying the same node yields the same node, so no harm).
 * The Connection tab and the screen, reactions and filler sections reflect their own nodes; this layer covers the rest of the panel.
 */

import type { createSessionDiagnosticsStore } from "../../io/chat/conversation/session-diagnostics";
import type { DelegationItem } from "../../io/chat/push/push-frames";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { type createAgentSettings, REASONING_EFFORTS } from "../../settings/backend/agent-settings";
import type { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import {
  type createVadSettings,
  VAD_SILENCE_MAX,
  VAD_SILENCE_MIN,
} from "../../settings/voice/vad-settings";
import { renderDelegationRows } from "../chips/delegation-rows";
import type { VoiceInputStatusSnapshot } from "../chips/voice-input-status";
import { getLocale, t } from "../i18n";
import { LANG_PICKER_ORDER } from "./constants";
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
}

export interface Reflect {
  reflectSettings(): void;
  reflectSwitchRows(): void;
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
    vad,
    agentSettings,
    sessionDiagnostics,
    getPushState,
    delegations,
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

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    switchSubEl.textContent = t(on ? "screenshot.foot_on" : "screenshot.foot_off");
    root.classList.toggle("is-on", on);
  }

  const reflectSwitchRowsFromDeps = (): void => reflectSwitchRows(root, switchRows);

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
    reflectVad,
    reflectAgent,
    reflectLanguage,
    reflectSession,
    reflectDelegations,
    reflectVoiceStatus,
  };
}
