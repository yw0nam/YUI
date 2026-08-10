/**
 * agent_source — agent lifecycle firing source.
 *
 * Event-driven (inbox push). Listens on two channels:
 *  1. OS idle ticks (OS_EVENT_CHANNEL) — tracks presence; detects idle→present edge.
 *  2. agent-inbox (onAgentInbox) — receives AgentEvent lifecycle events from the Tauri side.
 *
 * When present AND the pipeline is idle: inbox arrival fires agent.done or
 * agent.needs_input immediately, per the event's phase.
 * When present-but-busy (backend call in flight or speech playing) OR away: events
 * buffer per-tool (BUFFER_CAP = 5, drop oldest on overflow). Within a tool's buffer, an
 * arrival sharing session_id and phase with an already-buffered entry replaces it in
 * place instead of appending — a chatty session's repeated prompts can't evict other
 * sessions' buffered events out of the cap.
 * On the idle→present edge OR the busy→idle edge: if buffer has content, fires ONE
 * agent.catchup (flatten all tools, sort by ts ascending), then clears the buffer.
 *
 * firing ≠ judgment: this only fires candidate events — the backend decides whether/what to
 * speak. No speak/don't-speak gate and no persona state live here.
 */

import type { AgentEvent } from "../io/agent-inbox";
import { onAgentInbox } from "../io/agent-inbox";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { EventBus } from "./event-bus";

const log = createLogger("agent-source");

/** Per-tool buffer cap — oldest entry dropped when exceeded. */
const BUFFER_CAP = 5;

interface AgentSourceDeps {
  bus: Pick<EventBus, "push">;
  /** Present iff cached OS idle ≤ this. */
  present_max_idle_ms: number;
  /** Read on every inbox arrival — gates firing without stopping the listener. */
  isEnabled: () => boolean;
  /** Injectable inbox subscriber; defaults to the real onAgentInbox. */
  onInbox?: (cb: (p: AgentEvent) => void, deps?: { listen?: OsEventListen }) => () => void;
  /** Injectable channel listen; defaults to the resolved Tauri listen. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Whether the dispatcher pipeline is busy (backend call in flight or speech playing). Absent = never busy. */
  isPipelineBusy?: () => boolean;
  /** Subscribe to pipeline-busy transitions; used to flush the buffer on the busy→idle edge. */
  subscribePipelineBusy?: (cb: (busy: boolean) => void) => () => void;
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
  let unlistenBusy: (() => void) | undefined;

  /** Per-tool buffered lifecycle events (away or busy accumulation). */
  const buffer = new Map<string, AgentEvent[]>();

  function isPresent(): boolean {
    return lastIdleMs != null && lastIdleMs <= present_max_idle_ms;
  }

  function isBusy(): boolean {
    return deps.isPipelineBusy?.() ?? false;
  }

  /** Flatten all buffered items across tools, sort by ts ascending, emit ONE catchup. */
  function flushCatchup(): void {
    if (buffer.size === 0) return;
    const items: Array<{
      tool: string;
      project: string;
      status?: "success" | "error";
      phase: "done" | "needs_input";
      session_id?: string;
      detail?: string;
      summary: string;
      ts: number;
    }> = [];
    for (const arr of buffer.values()) {
      for (const p of arr) {
        items.push({
          tool: p.tool,
          project: p.project,
          ...(p.status !== undefined ? { status: p.status } : {}),
          phase: p.phase,
          ...(p.session_id !== undefined ? { session_id: p.session_id } : {}),
          ...(p.detail !== undefined ? { detail: p.detail } : {}),
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

  /** Flush iff enabled, buffer non-empty, present, and the pipeline is idle. */
  function maybeFlush(): void {
    if (!isEnabled() || buffer.size === 0 || !isPresent() || isBusy()) return;
    flushCatchup();
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
    if (!wasPresent && present) {
      maybeFlush();
    }
    wasPresent = present;
  }

  function handleInbox(p: AgentEvent): void {
    if (!isEnabled()) return;
    // Guard against malformed IPC payloads that slipped through the type cast.
    try {
      const tool = (p as unknown as { tool?: unknown })?.tool;
      if (typeof tool !== "string") {
        log.debug("inbox_malformed", { degrade: true });
        return;
      }
      const phase = (p as unknown as { phase?: unknown })?.phase;
      if (phase !== "done" && phase !== "needs_input") {
        log.debug("inbox_malformed_phase", { degrade: true });
        return;
      }
      if (isPresent() && !isBusy()) {
        bus.push({
          source: "timer_scheduler",
          event_name: phase === "needs_input" ? "agent.needs_input" : "agent.done",
          ts: now(),
          hint_tier: 2,
          dnd_override: false,
          payload: {
            tool: p.tool,
            project: p.project,
            cwd: p.cwd,
            ...(p.status !== undefined ? { status: p.status } : {}),
            phase: p.phase,
            ...(p.session_id !== undefined ? { session_id: p.session_id } : {}),
            ...(p.detail !== undefined ? { detail: p.detail } : {}),
            summary: p.summary,
            ts: p.ts,
          },
        });
      } else {
        // Buffer per tool; an arrival sharing session_id+phase with an already-buffered
        // entry replaces it in place, so a chatty session's repeated prompts can't evict
        // other sessions' buffered events out of the cap. Otherwise append, drop the
        // oldest when the cap is exceeded.
        const arr = buffer.get(p.tool) ?? [];
        const dupIdx =
          p.session_id !== undefined
            ? arr.findIndex((item) => item.session_id === p.session_id && item.phase === p.phase)
            : -1;
        if (dupIdx !== -1) {
          arr[dupIdx] = p;
        } else {
          arr.push(p);
          if (arr.length > BUFFER_CAP) arr.shift();
        }
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
    unlistenIdle = await subscribeOsEvent({
      listen: deps.listen,
      onTick,
      log,
      subscribeTag: "subscribe_idle_failed",
    });

    // Subscribe to agent completions.
    try {
      const inbox = deps.onInbox ?? onAgentInbox;
      unlistenInbox = inbox(handleInbox, { listen: deps.listen });
    } catch (err) {
      log.debug("subscribe_inbox_failed", { degrade: true, error: String(err) });
    }

    // Flush on the busy→idle edge (mirrors the idle→present edge above).
    unlistenBusy = deps.subscribePipelineBusy?.((busy) => {
      if (!busy) maybeFlush();
    });
  }

  function stop(): void {
    running = false;
    unlistenIdle?.();
    unlistenIdle = undefined;
    unlistenInbox?.();
    unlistenInbox = undefined;
    unlistenBusy?.();
    unlistenBusy = undefined;
  }

  return { start, stop };
}
