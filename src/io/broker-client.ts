/**
 * Expression Broker MCP write-only client. YUI publishes its renderable vocabulary;
 * it never subscribes. Stateless + best-effort: never throws to the caller, never blocks boot
 * — all transport failures degrade to a warn log. publish() is idempotent: it diffs
 * against the broker's current ids and only sends the tools that changed. start() runs a liveness
 * poll that re-publishes when a broker restart is inferred (version regression / drift).
 *
 * Transport: FastMCP streamable-http. Each rpc cycle = initialize → notifications/initialized →
 * tools/call(s), reusing the mcp-session-id captured from the initialize response. Responses are
 * SSE-framed (`event: message\ndata: {json}`); a tool payload lives in result.content[0].text as a
 * JSON string.
 */

import type { AppConfig } from "../config/load";
import type { MotionRegistry } from "../contract";
import { createLogger, type Logger } from "../logger";
import { type ExpressMotionSettings, enabledExpressMotions } from "./express-motion-settings";

export interface BrokerVocab {
  emotion_ids: string[];
  motion_ids: string[];
  emotion_text_mode: "free" | "enum";
  emotion_text_map: Record<string, string>;
  version: number;
}

export interface BrokerPayload {
  emotionIds: string[];
  motionIds: string[];
  emotionText: { mode: "free" | "enum"; table: Record<string, string> | null };
}

interface BrokerClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
  pollIntervalMs?: number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export interface BrokerClient {
  getIds(): Promise<BrokerVocab | null>;
  publish(payload: BrokerPayload): Promise<void>;
  start(): void;
  stop(): void;
  dispose(): void;
}

const DEFAULT_POLL_MS = 20_000;

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Order-insensitive set equality over string ids. */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/** Shallow equality of an emotion_text_map (string→string). */
function sameTable(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/** Extract the first SSE `data:` line and JSON.parse it. Returns null when absent/unparseable. */
function parseSse(text: string): unknown {
  const lines = text.split("\n");
  const data = lines
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice("data: ".length))
    .join("");
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function createBrokerClient(opts: BrokerClientOptions): BrokerClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const log = opts.logger ?? createLogger("broker-client");
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const setIntervalImpl = opts.setInterval ?? setInterval;
  const clearIntervalImpl = opts.clearInterval ?? clearInterval;

  let nextId = 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastPayload: BrokerPayload | null = null;
  let lastObservedVersion: number | null = null;
  let inflight: Promise<void> = Promise.resolve();
  let disposed = false;

  /**
   * One MCP cycle: initialize, send initialized, then run the provided tool calls on the same
   * session. Returns parsed tool payloads (one per call, null on per-call failure), or null if the
   * handshake itself fails. Never throws.
   */
  async function rpc(calls: ToolCall[]): Promise<(unknown | null)[] | null> {
    try {
      const initRes = await fetchImpl(opts.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId++,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "yui", version: "0" },
          },
        }),
      });
      if (!initRes.ok) {
        log.warn("initialize_failed", { status: initRes.status });
        return null;
      }
      const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;
      // drain the SSE body so the connection is consumed (result unused)
      await initRes.text();

      const sessionHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      };

      await fetchImpl(opts.baseUrl, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });

      const results: (unknown | null)[] = [];
      for (const call of calls) {
        const id = nextId++;
        try {
          const res = await fetchImpl(opts.baseUrl, {
            method: "POST",
            headers: sessionHeaders,
            body: JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name: call.name, arguments: call.arguments },
            }),
          });
          if (!res.ok) {
            log.warn("tool_call_failed", { tool: call.name, status: res.status });
            results.push(null);
            continue;
          }
          results.push(parseToolPayload(await res.text(), call.name));
        } catch (err) {
          log.warn("tool_call_threw", { tool: call.name, error: String(err) });
          results.push(null);
        }
      }
      return results;
    } catch (err) {
      log.warn("rpc_threw", { error: String(err) });
      return null;
    }
  }

  /** Parse an SSE tool-call response → result.content[0].text(JSON). null on any malformation. */
  function parseToolPayload(text: string, tool: string): unknown | null {
    const env = parseSse(text);
    if (!env || typeof env !== "object") {
      log.warn("tool_reply_unparseable", { tool });
      return null;
    }
    const result = (env as { result?: unknown }).result;
    if (!result || typeof result !== "object") {
      log.warn("tool_reply_missing_result", { tool });
      return null;
    }
    if ((result as { isError?: boolean }).isError) {
      log.warn("tool_reply_is_error", { tool });
      return null;
    }
    const content = (result as { content?: Array<{ text?: string }> }).content;
    const raw = content?.[0]?.text;
    if (typeof raw !== "string") {
      log.warn("tool_reply_missing_content", { tool });
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      log.warn("tool_reply_content_not_json", { tool });
      return null;
    }
  }

  async function getIds(): Promise<BrokerVocab | null> {
    const out = await rpc([{ name: "get_ids", arguments: {} }]);
    const payload = out?.[0];
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Partial<BrokerVocab>;
    if (
      !Array.isArray(p.emotion_ids) ||
      !Array.isArray(p.motion_ids) ||
      (p.emotion_text_mode !== "free" && p.emotion_text_mode !== "enum") ||
      typeof p.version !== "number"
    ) {
      log.warn("get_ids_payload_invalid");
      return null;
    }
    return {
      emotion_ids: p.emotion_ids,
      motion_ids: p.motion_ids,
      emotion_text_mode: p.emotion_text_mode,
      emotion_text_map: p.emotion_text_map ?? {},
      version: p.version,
    };
  }

  /** Build the tool calls needed to reconcile `current` → `payload`. */
  function diffCalls(payload: BrokerPayload, current: BrokerVocab | null): ToolCall[] {
    const calls: ToolCall[] = [];
    if (!current || !sameIds(current.emotion_ids, payload.emotionIds)) {
      calls.push({ name: "update_emotion_ids", arguments: { ids: payload.emotionIds } });
    }
    if (!current || !sameIds(current.motion_ids, payload.motionIds)) {
      calls.push({ name: "update_motion_ids", arguments: { ids: payload.motionIds } });
    }
    const wantMode = payload.emotionText.mode;
    const wantTable = payload.emotionText.table;
    const tableDiffers =
      wantMode === "enum" ? !sameTable(current?.emotion_text_map ?? {}, wantTable ?? {}) : false;
    if (!current || current.emotion_text_mode !== wantMode || tableDiffers) {
      calls.push({
        name: "update_emotion_text",
        arguments: { mode: wantMode, table: wantTable },
      });
    }
    return calls;
  }

  async function publishNow(payload: BrokerPayload): Promise<void> {
    if (disposed) return;
    const current = await getIds();
    if (current) lastObservedVersion = current.version;
    const updates = diffCalls(payload, current);
    if (updates.length === 0) return;
    const results = await rpc(updates);
    if (results) {
      results.forEach((r, i) => {
        const ok = (r as { ok?: boolean } | null)?.ok;
        if (ok !== true) log.warn("update_not_ok", { tool: updates[i].name });
        const v = (r as { version?: number } | null)?.version;
        if (typeof v === "number") lastObservedVersion = v;
      });
    }
  }

  /**
   * Queued behind whatever publish is still in flight, so each one diffs against the state its
   * predecessor left on the broker. Rapid user edits would otherwise race and land out of order.
   * The chain the next publish waits on swallows rejections — the caller still sees them, but one
   * failure never wedges the queue. `lastPayload` is recorded here rather than at execution, so a
   * poll firing while this payload is queued republishes it and not the one still executing.
   */
  function publish(payload: BrokerPayload): Promise<void> {
    lastPayload = payload;
    const next = inflight.then(() => publishNow(payload));
    inflight = next.catch(() => {});
    return next;
  }

  async function poll(): Promise<void> {
    if (!lastPayload) return;
    const vocab = await getIds();
    if (!vocab) {
      log.warn("poll_unreachable", { retry: true });
      return;
    }
    const regressed = lastObservedVersion !== null && vocab.version < lastObservedVersion;
    const drifted =
      !sameIds(vocab.emotion_ids, lastPayload.emotionIds) ||
      !sameIds(vocab.motion_ids, lastPayload.motionIds) ||
      vocab.emotion_text_mode !== lastPayload.emotionText.mode;
    lastObservedVersion = vocab.version;
    if (regressed || drifted) {
      log.warn("restart_inferred", {
        republish: true,
        version: vocab.version,
        regressed,
        drifted,
      });
      await publish(lastPayload);
    }
  }

  function start(): void {
    if (disposed || timer !== null) return;
    timer = setIntervalImpl(() => poll(), pollMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearIntervalImpl(timer);
      timer = null;
    }
  }

  /** Retires the client: the poll stops and anything still queued never reaches the wire. */
  function dispose(): void {
    disposed = true;
    stop();
  }

  return {
    getIds,
    publish,
    start,
    stop,
    dispose,
  };
}

/**
 * Motion keys the agent may trigger via generate_express/motion cues — excludes reactive, ambient,
 * and `broker_publish:false` entries. Shared by the broker payload and the CC generate_express
 * tool's motion_id enum, so both stay in lockstep with the same registry.
 */
export function agentTriggerableMotionIds(motions: MotionRegistry): string[] {
  return Object.entries(motions)
    .filter(
      ([, entry]) =>
        entry.kind !== "reactive" && entry.kind !== "ambient" && entry.broker_publish !== false,
    )
    .map(([id]) => id);
}

/**
 * Pure derivation of the broker payload from loaded config. emotion ids = registry keys; motion ids
 * = agent-triggerable motion keys (see agentTriggerableMotionIds) narrowed by the user's
 * expression-motion selection — the one seam both vocabulary consumers read, so the broker publish
 * and the Chat-Completions tool schema always carry the same list. The selection is required, so
 * no caller can publish the unfiltered catalog by leaving it out.
 * emotion_text is the emoji enum table (docs/reference/tts-emotion); a missing table falls back to
 * free/null with a warn rather than crashing.
 */
export function deriveBrokerPayload(
  cfg: AppConfig,
  emotionTextTable: Record<string, string> | null,
  opts: { expressMotions: ExpressMotionSettings; logger?: Logger },
): BrokerPayload {
  const log = opts.logger ?? createLogger("broker-client");
  const emotionIds = Object.keys(cfg.emotionRegistry);
  const motionIds = enabledExpressMotions(
    agentTriggerableMotionIds(cfg.motions),
    opts.expressMotions,
  );

  let emotionText: BrokerPayload["emotionText"];
  if (emotionTextTable) {
    emotionText = { mode: "enum", table: emotionTextTable };
  } else {
    log.warn("emotion_text_table_missing", { fallback: "free" });
    emotionText = { mode: "free", table: null };
  }

  return { emotionIds, motionIds, emotionText };
}
