/**
 * Reflect (store→DOM synchronization) layer — reflects all store state onto the panel DOM.
 * Each reflect function reads one section's store and renders it to the corresponding DOM node (switches, sliders, segs, inputs, session readout).
 * DOM nodes are queried directly from deps.root (entry handlers querying the same node yields the same node, so no harm).
 * The Connection tab and the screenshot, screen, reactions, agent, filler and voice input sections reflect their own nodes; this layer covers the rest of the panel.
 */

import type { createSessionDiagnosticsStore } from "../../io/chat/conversation/session-diagnostics";
import type { DelegationItem } from "../../io/chat/push/push-frames";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { renderDelegationRows } from "../chips/delegation-rows";
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
  reflectSwitchRows(): void;
  reflectSession(): void;
  reflectDelegations(): void;
}

export function createReflect(deps: ReflectDeps): Reflect {
  const { root, switchRows, sessionDiagnostics, getPushState, delegations } = deps;

  const sessionStatEl = root.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = root.querySelector<HTMLSpanElement>(".yui-session__value");
  const sessionDelegEl = root.querySelector<HTMLDivElement>(".yui-session__deleg");
  const sessionDelegRowsEl = root.querySelector<HTMLDivElement>(".yui-session__deleg-rows");
  const sessionDelegLostEl = root.querySelector<HTMLParagraphElement>(".yui-session__deleg-lost");

  const reflectSwitchRowsFromDeps = (): void => reflectSwitchRows(root, switchRows);

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

  return {
    reflectSwitchRows: reflectSwitchRowsFromDeps,
    reflectSession,
    reflectDelegations,
  };
}
