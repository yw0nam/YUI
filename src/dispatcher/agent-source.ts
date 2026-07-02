/**
 * agent_source — agent completion firing source.
 *
 * Event-driven (inbox push) sibling of github-source. Listens on two channels:
 *  1. OS idle ticks (OS_EVENT_CHANNEL) — tracks presence; detects idle→present edge.
 *  2. agent-inbox (onAgentInbox) — receives AgentDone completions from the Tauri side.
 *
 * When present: inbox arrival fires agent.done immediately.
 * When away: completions buffer per-tool (BUFFER_CAP = 5, drop oldest on overflow).
 * On idle→present edge: if buffer has content, fires ONE agent.catchup (flatten all
 * tools, sort by ts ascending), then clears the buffer.
 *
 * firing ≠ judgment: this only fires candidate events — the backend decides whether/what to
 * speak. No speak/don't-speak gate and no persona state live here.
 */

import type { AgentDone } from "../io/agent-inbox";
import { onAgentInbox } from "../io/agent-inbox";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { OS_EVENT_CHANNEL, resolveTauriListen } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { EventBus } from "./event-bus";

const log = createLogger("agent-source");

/** Per-tool buffer cap — oldest entry dropped when exceeded. */
const BUFFER_CAP = 5;

export interface AgentSourceDeps {
  bus: Pick<EventBus, "push">;
  /** Present iff cached OS idle ≤ this (same semantics as github-source). */
  present_max_idle_ms: number;
  /** Read on every inbox arrival — gates firing without stopping the listener. */
  isEnabled: () => boolean;
  /** Injectable inbox subscriber; defaults to the real onAgentInbox. */
  onInbox?: (cb: (p: AgentDone) => void, deps?: { listen?: OsEventListen }) => () => void;
  /** Injectable channel listen; defaults to the resolved Tauri listen. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export function createAgentSource(deps: AgentSourceDeps): { start(): Promise<void>; stop(): void } {
  const { bus, present_max_idle_ms, isEnabled } = deps;
  const now = deps.now ?? Date.now;

  let lastIdleMs: number | null = null;
  /** Tracks previous tick's present state for idle→present edge detection. */
  let wasPresent = false;
  let running = false;
  let unlistenIdle: (() => void) | undefined;
  let unlistenInbox: (() => void) | undefined;

  /** Per-tool buffered completions (away accumulation). */
  const buffer = new Map<string, AgentDone[]>();

  function isPresent(): boolean {
    return lastIdleMs != null && lastIdleMs <= present_max_idle_ms;
  }

  /** Flatten all buffered items across tools, sort by ts ascending, emit ONE catchup. */
  function flushCatchup(): void {
    if (buffer.size === 0) return;
    const items: Array<{
      tool: string;
      project: string;
      status?: "success" | "error";
      summary: string;
      ts: number;
    }> = [];
    for (const arr of buffer.values()) {
      for (const p of arr) {
        items.push({
          tool: p.tool,
          project: p.project,
          ...(p.status !== undefined ? { status: p.status } : {}),
          summary: p.summary,
          ts: p.ts,
        });
      }
    }
    items.sort((a, b) => a.ts - b.ts);
    bus.push({
      source: "timer_scheduler",
      event_name: "agent.catchup",
      ts: now(),
      hint_tier: 2,
      dnd_override: false,
      payload: { count: items.length, items },
    });
    buffer.clear();
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    lastIdleMs = payload.data.os_idle_ms ?? null;
    const present = isPresent();
    // A mid-away disable must not let previously-buffered completions survive to a
    // later re-enable — drop the stale buffer now so it can't leak into a future flush.
    if (!isEnabled() && buffer.size > 0) {
      buffer.clear();
    }
    // Flush on the idle→present edge only (not on every present tick).
    // isEnabled() guard mirrors handleInbox — a mid-run toggle must not dispatch
    // a catchup the user has since disabled.
    if (!wasPresent && present && buffer.size > 0 && isEnabled()) {
      flushCatchup();
    }
    wasPresent = present;
  }

  function handleInbox(p: AgentDone): void {
    if (!isEnabled()) return;
    // Guard against malformed IPC payloads that slipped through the type cast.
    try {
      if (typeof (p as unknown as { tool?: unknown })?.tool !== "string") {
        log.debug("inbox_malformed", { degrade: true });
        return;
      }
      const present = isPresent();
      if (present) {
        bus.push({
          source: "timer_scheduler",
          event_name: "agent.done",
          ts: now(),
          hint_tier: 2,
          dnd_override: false,
          payload: {
            tool: p.tool,
            project: p.project,
            cwd: p.cwd,
            ...(p.status !== undefined ? { status: p.status } : {}),
            summary: p.summary,
            ts: p.ts,
          },
        });
      } else {
        // Buffer per tool, drop the oldest when the cap is exceeded.
        const arr = buffer.get(p.tool) ?? [];
        arr.push(p);
        if (arr.length > BUFFER_CAP) arr.shift();
        buffer.set(p.tool, arr);
      }
    } catch (err) {
      log.debug("inbox_error", { degrade: true, error: String(err) });
    }
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;

    // Subscribe to OS idle ticks for presence tracking and edge detection.
    let listen: OsEventListen | undefined;
    try {
      listen = deps.listen ?? (await resolveTauriListen());
    } catch (err) {
      log.debug("listen_resolve_failed", { degrade: true, error: String(err) });
    }
    if (listen) {
      try {
        unlistenIdle = await listen(OS_EVENT_CHANNEL, ({ payload }) => onTick(payload));
      } catch (err) {
        log.debug("subscribe_idle_failed", { degrade: true, error: String(err) });
      }
    }

    // Subscribe to agent completions.
    try {
      const inbox = deps.onInbox ?? onAgentInbox;
      unlistenInbox = inbox(handleInbox, { listen: deps.listen });
    } catch (err) {
      log.debug("subscribe_inbox_failed", { degrade: true, error: String(err) });
    }
  }

  function stop(): void {
    running = false;
    unlistenIdle?.();
    unlistenIdle = undefined;
    unlistenInbox?.();
    unlistenInbox = undefined;
  }

  return { start, stop };
}
