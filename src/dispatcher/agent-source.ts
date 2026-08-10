/**
 * agent_source — agent lifecycle firing source.
 *
 * Configures the shared buffered-inbox core (`buffered-inbox-source.ts`) with the
 * agent-specific policy:
 *  - Buffer: a `Map<string, AgentEvent[]>` keyed per tool (BUFFER_CAP = 5, drop oldest
 *    per tool on overflow). Within a tool's buffer, an arrival sharing session_id and
 *    phase with an already-buffered entry replaces it in place instead of appending — a
 *    chatty session's repeated prompts can't evict other sessions' buffered events out
 *    of the cap.
 *  - Catchup: flatten all tools, sort by ts ascending, rebuild each item into a
 *    five-field object (no `cwd` — that's live-only).
 *  - Live firing: agent.done or agent.needs_input, per the event's phase, payload
 *    reshaped from the raw AgentEvent (includes `cwd`).
 *
 * firing ≠ judgment: this only fires candidate events — the backend decides whether/what to
 * speak. No speak/don't-speak gate and no persona state live here.
 */

import type { AgentEvent } from "../io/agent-inbox";
import { onAgentInbox } from "../io/agent-inbox";
import type { OsEventListen } from "../io/tauri-listen";
import { createLogger } from "../logger";
import { createBufferedInboxSource, type InboxFiring } from "./buffered-inbox-source";
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

/** Reshaped catchup item — no `cwd` (live-only). */
interface CatchupItem {
  tool: string;
  project: string;
  status?: "success" | "error";
  phase: "done" | "needs_input";
  session_id?: string;
  detail?: string;
  summary: string;
  ts: number;
}

function toCatchupItem(p: AgentEvent): CatchupItem {
  return {
    tool: p.tool,
    project: p.project,
    ...(p.status !== undefined ? { status: p.status } : {}),
    phase: p.phase,
    ...(p.session_id !== undefined ? { session_id: p.session_id } : {}),
    ...(p.detail !== undefined ? { detail: p.detail } : {}),
    summary: p.summary,
    ts: p.ts,
  };
}

export function createAgentSource(deps: AgentSourceDeps): { start(): Promise<void>; stop(): void } {
  /** Per-tool buffered lifecycle events (away or busy accumulation). */
  const buffer = new Map<string, AgentEvent[]>();

  function parse(p: AgentEvent): AgentEvent | undefined {
    const tool = (p as unknown as { tool?: unknown })?.tool;
    if (typeof tool !== "string") {
      log.debug("inbox_malformed", { degrade: true });
      return undefined;
    }
    const phase = (p as unknown as { phase?: unknown })?.phase;
    if (phase !== "done" && phase !== "needs_input") {
      log.debug("inbox_malformed_phase", { degrade: true });
      return undefined;
    }
    return p;
  }

  function buildLive(p: AgentEvent): InboxFiring {
    return {
      event_name: p.phase === "needs_input" ? "agent.needs_input" : "agent.done",
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
    };
  }

  // Buffer per tool; an arrival sharing session_id+phase with an already-buffered
  // entry replaces it in place, so a chatty session's repeated prompts can't evict
  // other sessions' buffered events out of the cap. Otherwise append, drop the
  // oldest when the cap is exceeded.
  function bufferAdd(p: AgentEvent): void {
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

  /** Flatten all buffered items across tools, sort by ts ascending. */
  function buildCatchup(): InboxFiring {
    const items: CatchupItem[] = [];
    for (const arr of buffer.values()) {
      for (const p of arr) items.push(toCatchupItem(p));
    }
    items.sort((a, b) => a.ts - b.ts);
    return { event_name: "agent.catchup", payload: { count: items.length, items } };
  }

  return createBufferedInboxSource<AgentEvent>({
    bus: deps.bus,
    present_max_idle_ms: deps.present_max_idle_ms,
    isEnabled: deps.isEnabled,
    onInbox: deps.onInbox ?? onAgentInbox,
    listen: deps.listen,
    now: deps.now,
    isPipelineBusy: deps.isPipelineBusy,
    subscribePipelineBusy: deps.subscribePipelineBusy,
    log,
    parse,
    buildLive,
    bufferAdd,
    bufferEmpty: () => buffer.size === 0,
    bufferClear: () => buffer.clear(),
    buildCatchup,
  });
}
