/**
 * Session section — owns the context-occupancy readout and the delegated-work list of the settings
 * window: node queries, both redraws, the three subscriptions, the minute refresh, and teardown.
 */

import type { createSessionDiagnosticsStore } from "../../../../io/chat/conversation/session-diagnostics";
import type { DelegationItem } from "../../../../io/chat/push/push-frames";
import { renderDelegationRows } from "../../../chips/delegation-rows";
import type { PushSocketPanelPort } from "../../connection/connection-tab";
import { createDelegationSync } from "../../delegations/delegation-sync";

interface SessionSectionDeps {
  /** Panel root (el) — query the readout and the delegated list here. */
  root: HTMLElement;
  /** Session diagnostics (context usage · last compression). Absent where the readout is not rendered. */
  sessionDiagnostics?: ReturnType<typeof createSessionDiagnosticsStore>;
  /** Push transport — its state drives the delegated list's lost line. */
  pushSocket?: Pick<PushSocketPanelPort, "getState" | "onState">;
  /** Whether push chat is the effective mode; the lost line follows the socket only then. */
  isPushMode: () => boolean;
  /** The delegations list the section renders. Absent where nothing mirrors it. */
  delegations?: {
    get(): DelegationItem[];
    subscribe(cb: () => void): () => void;
    refresh?(): void;
  };
  /** Popover open state — the diagnostics and push-state subscriptions redraw only while open. */
  isOpen: () => boolean;
}

interface SessionSection {
  /** Render the readout, then sync the delegated list and its minute refresh. */
  reflect(): void;
  /** Permanent teardown — unsubscribe the three sources and clear the minute refresh. */
  dispose(): void;
}

// Format token count as "18.2K" / "18K" / "200K". Below 1000 stays as-is,
// below 100K shows one decimal (dropping .0), 100K+ shows integer.
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}K`;
  return `${k.toFixed(1).replace(/\.0$/, "")}K`;
}

export function createSessionSection(deps: SessionSectionDeps): SessionSection {
  const { root, sessionDiagnostics, pushSocket, isPushMode, delegations, isOpen } = deps;

  const sessionStatEl = root.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = root.querySelector<HTMLSpanElement>(".yui-session__value");
  const sessionDelegEl = root.querySelector<HTMLDivElement>(".yui-session__deleg");
  const sessionDelegRowsEl = root.querySelector<HTMLDivElement>(".yui-session__deleg-rows");
  const sessionDelegLostEl = root.querySelector<HTMLParagraphElement>(".yui-session__deleg-lost");

  // The session section's lost line follows the socket only while push chat is effective.
  const getPushState = pushSocket
    ? () => (isPushMode() ? pushSocket.getState() : undefined)
    : undefined;

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

  const delegationSync = createDelegationSync({ delegations, reflectDelegations });

  // The socket moves on its own — the session section's rows follow whether or not a setting
  // changed. (The Connection tab keeps its own subscription for the status line.)
  const unsubscribePushState = pushSocket?.onState(() => {
    if (isOpen()) reflectDelegations();
  });
  // Reflect session diagnostics updates (this window's reset · pet window's reloadFromStorage) to readout.
  const unsubscribeSession = sessionDiagnostics?.subscribe(() => {
    if (isOpen()) reflectSession();
  });
  // Reflect delegated-work updates to the session section through the same sync that arms
  // its minute refresh.
  const unsubscribeDelegations = delegations?.subscribe(() => delegationSync.sync());

  return {
    reflect(): void {
      reflectSession();
      delegationSync.sync();
    },
    dispose(): void {
      unsubscribePushState?.();
      unsubscribeSession?.();
      unsubscribeDelegations?.();
      delegationSync.stop();
    },
  };
}
