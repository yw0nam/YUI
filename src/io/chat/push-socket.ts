/**
 * push-socket — the single WebSocket `chat_api: "push"` runs on.
 *
 * Turns go out on it and finished replies arrive on it, so a reply can arrive without a request.
 * The frames, the limits and the reconnect schedule are defined in docs/reference/push-transport.md.
 * The socket renders no judgment: it validates shape and hands every frame to its subscribers.
 */

import type { ExpressArgs } from "../../contract";
import { createLogger, type Logger } from "../../logger";
import type { BrokerPayload } from "./broker-client";

const baseLog = createLogger("push-socket");

/** Text frame size cap, either direction. */
export const PUSH_FRAME_MAX_BYTES = 256 * 1024;

const READY_WAIT_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Close code the backend uses for a rejected key. */
const AUTH_CLOSE_CODE = 4401;
const NORMAL_CLOSE_CODE = 1000;
/** Stands in for a close code when the attempt failed before a socket existed. */
const OPEN_FAILED_CODE = 0;

/** What the client can render right now, in the shape the backend receives. */
export interface PushVocabulary {
  emotion_ids: string[];
  motion_ids: string[];
  emotion_text_mode: "free" | "enum";
  emotion_text_map: Record<string, string>;
}

/** One ordered piece of a reply: its cues render, then its speech is spoken. */
export interface RenderSegment {
  cues?: ExpressArgs[];
  speech?: string;
}

/** A finished backend turn. Every frame the backend sends names the turn it belongs to. */
export interface RenderFrame {
  type: "render";
  turn_id: string;
  source: string;
  segments: RenderSegment[];
  /** The reasoning written so far for this turn when the reply was sent; absent when there was none. */
  reasoning?: string;
}

/** One finished sentence of a reply the backend is still writing; the turn's next render closes it. */
export interface SpeechFrame {
  type: "speech";
  turn_id: string;
  segments: RenderSegment[];
}

/** One piece of work the backend handed to a background worker. */
export interface DelegationItem {
  id: string;
  title: string;
  started_at: number;
  state: "running" | "done";
  ended_at?: number;
  status?: "ok" | "error" | "unknown";
  summary?: string;
}

/** The backend closed a turn: the running state the `turn` frame set is released. */
export interface TurnEndFrame {
  type: "turn_end";
  turn_id: string;
}

/** The backend names the tool a turn is using; `running` when the call starts, `done` when it returns. */
export interface ToolStatusFrame {
  type: "tool_status";
  turn_id: string;
  state: "running" | "done";
  tool_id: string;
}

export interface PushTurnFrame {
  turn_id: string;
  /** The `<client_context>` block text, exactly as the other transports send it. */
  client_context: string;
  /** The user utterance; `""` on a turn no user typed or spoke. */
  text: string;
}

export type PushSocketState =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "ready"; chat_id: string }
  | { kind: "reconnecting"; delay_ms: number }
  | { kind: "failed"; code: number };

export interface PushSocketDeps {
  /** Chat endpoint base, read on every attempt; the socket URL is this with `/ws` and a ws scheme. */
  chatBaseUrl: () => string;
  /** The conversation id the backend keeps state under. */
  chatId: () => string;
  /** Chat API key, resolved on every connection attempt so a key edit lands on the next one. */
  getKey: () => Promise<string | undefined>;
  /** The renderable vocabulary as it stands now. */
  vocabulary: () => PushVocabulary;
  WebSocketImpl?: typeof WebSocket;
  logger?: Logger;
}

export interface PushSocket {
  connect(): void;
  /** Close and stay closed. A later connect() opens again with the settings as they stand then. */
  disconnect(): void;
  /** Drop any pending backoff wait and open now, with the key as it stands. */
  reconnectNow(): void;
  dispose(): void;
  /** True when the frame went out; false when the socket is not ready or the frame is too large. */
  sendTurn(turn: PushTurnFrame): boolean;
  sendReset(): boolean;
  /** Sends the current vocabulary when it differs from the one the backend last received. */
  sendVocabulary(): void;
  onRender(cb: (frame: RenderFrame) => void): () => void;
  onSpeech(cb: (frame: SpeechFrame) => void): () => void;
  onTurnEnd(cb: (frame: TurnEndFrame) => void): () => void;
  onToolStatus(cb: (frame: ToolStatusFrame) => void): () => void;
  onDelegations(cb: (items: DelegationItem[]) => void): () => void;
  onReasoning(cb: (delta: string) => void): () => void;
  onState(cb: (state: PushSocketState) => void): () => void;
  getState(): PushSocketState;
}

/** `<chat_base_url>/ws` over ws/wss, with any trailing slashes on the base collapsed. */
export function pushSocketUrl(chatBaseUrl: string): string {
  const base = chatBaseUrl.replace(/\/+$/, "");
  return `${base.replace(/^http/, "ws")}/ws`;
}

/** The published renderable vocabulary in the shape the backend receives. */
export function pushVocabularyOf(published: BrokerPayload | undefined): PushVocabulary {
  return {
    emotion_ids: published?.emotionIds ?? [],
    motion_ids: published?.motionIds ?? [],
    emotion_text_mode: published?.emotionText.mode ?? "free",
    emotion_text_map: published?.emotionText.table ?? {},
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** An ordered list of objects whose speech is text and whose cues are objects. */
function segmentsReadable(segments: unknown): boolean {
  if (!Array.isArray(segments)) return false;
  for (const segment of segments) {
    if (segment === null || typeof segment !== "object" || Array.isArray(segment)) return false;
    const { speech, cues } = segment as { speech?: unknown; cues?: unknown };
    if (speech !== undefined && typeof speech !== "string") return false;
    if (
      cues !== undefined &&
      (!Array.isArray(cues) ||
        cues.some((cue) => cue === null || typeof cue !== "object" || Array.isArray(cue)))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The field that makes a render frame unreadable, or null when the client can act on it: readable
 * segments, a source to log, and the string turn id it answers. A turn_id of another type would
 * leave the turn that sent it waiting out its whole budget.
 */
function renderFrameFault(v: Record<string, unknown>): string | null {
  if (!segmentsReadable(v.segments)) return "segments";
  if (typeof v.source !== "string") return "source";
  if (typeof v.turn_id !== "string") return "turn_id";
  return null;
}

/** The field that makes a speech frame unreadable, or null: readable segments and a string turn id. */
function speechFrameFault(v: Record<string, unknown>): string | null {
  if (!segmentsReadable(v.segments)) return "segments";
  if (typeof v.turn_id !== "string") return "turn_id";
  return null;
}

export function createPushSocket(deps: PushSocketDeps): PushSocket {
  const log = deps.logger ?? baseLog;
  const WS = deps.WebSocketImpl ?? globalThis.WebSocket;

  const renderSubs = new Set<(frame: RenderFrame) => void>();
  const speechSubs = new Set<(frame: SpeechFrame) => void>();
  const turnEndSubs = new Set<(frame: TurnEndFrame) => void>();
  const toolStatusSubs = new Set<(frame: ToolStatusFrame) => void>();
  const delegationSubs = new Set<(items: DelegationItem[]) => void>();
  const reasoningSubs = new Set<(delta: string) => void>();
  const stateSubs = new Set<(state: PushSocketState) => void>();

  let ws: WebSocket | null = null;
  let ready = false;
  let disposed = false;
  /** Between connect() and disconnect()/dispose() — only then does a close earn a reconnect. */
  let active = false;
  let delayMs = RECONNECT_MIN_MS;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** The vocabulary the backend last received, serialized, so only a real change resends it. */
  let sentVocabulary: string | null = null;
  /** An attempt between its key lookup and its socket, where `ws` is not yet the one being opened. */
  let opening = false;
  /** Bumped by every connect(); an attempt whose key resolved under an older one reads it again. */
  let epoch = 0;
  let state: PushSocketState = { kind: "disconnected" };

  function setState(next: PushSocketState): void {
    if (JSON.stringify(state) === JSON.stringify(next)) return;
    state = next;
    for (const cb of stateSubs) cb(next);
  }

  function clearTimers(): void {
    if (readyTimer) clearTimeout(readyTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    readyTimer = null;
    reconnectTimer = null;
  }

  function sendFrame(frame: Record<string, unknown>): boolean {
    if (!ws) return false;
    const text = JSON.stringify(frame);
    const bytes = byteLength(text);
    if (bytes > PUSH_FRAME_MAX_BYTES) {
      log.warn("frame_oversize", { type: frame.type, bytes, direction: "out" });
      return false;
    }
    ws.send(text);
    return true;
  }

  /** Sends the vocabulary when it differs from the one the backend last received. */
  function syncVocabulary(): void {
    if (!ready) return;
    const vocabulary = deps.vocabulary();
    const serialized = JSON.stringify(vocabulary);
    if (serialized === sentVocabulary) return;
    if (sendFrame({ type: "vocabulary", vocabulary })) sentVocabulary = serialized;
  }

  /** One broken subscriber is logged, not allowed to cost the rest of the frame's listeners. */
  function dispatch<T>(subs: Set<(value: T) => void>, value: T): void {
    for (const cb of subs) {
      try {
        cb(value);
      } catch (err) {
        log.warn("subscriber_failed", { error: String(err) });
      }
    }
  }

  function handleFrame(data: unknown): void {
    if (typeof data !== "string") return;
    if (byteLength(data) > PUSH_FRAME_MAX_BYTES) {
      log.warn("frame_oversize", { bytes: byteLength(data), direction: "in" });
      return;
    }
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch (err) {
      log.warn("frame_parse_failed", { error: String(err) });
      return;
    }
    if (frame === null || typeof frame !== "object") return;

    switch (frame.type) {
      case "ready": {
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = null;
        ready = true;
        delayMs = RECONNECT_MIN_MS;
        const chatId = typeof frame.chat_id === "string" ? frame.chat_id : deps.chatId();
        log.info("ws_ready", { chat_id: chatId });
        setState({ kind: "ready", chat_id: chatId });
        // The vocabulary may have moved while the handshake was in flight; hello carried the old one.
        syncVocabulary();
        return;
      }
      case "render": {
        const fault = renderFrameFault(frame);
        if (fault !== null) {
          log.warn("frame_malformed", { type: "render", field: fault });
          return;
        }
        if (frame.reasoning !== undefined && typeof frame.reasoning !== "string") {
          delete frame.reasoning;
        }
        const render = frame as unknown as RenderFrame;
        dispatch(renderSubs, render);
        return;
      }
      case "speech": {
        const fault = speechFrameFault(frame);
        if (fault !== null) {
          log.warn("frame_malformed", { type: "speech", field: fault });
          return;
        }
        dispatch(speechSubs, frame as unknown as SpeechFrame);
        return;
      }
      case "turn_end": {
        if (typeof frame.turn_id !== "string") {
          log.warn("frame_malformed", { type: "turn_end", field: "turn_id" });
          return;
        }
        const turnEnd = frame as unknown as TurnEndFrame;
        dispatch(turnEndSubs, turnEnd);
        return;
      }
      case "tool_status": {
        const field =
          typeof frame.turn_id !== "string"
            ? "turn_id"
            : frame.state !== "running" && frame.state !== "done"
              ? "state"
              : typeof frame.tool_id !== "string"
                ? "tool_id"
                : null;
        if (field !== null) {
          log.warn("frame_malformed", { type: "tool_status", field });
          return;
        }
        dispatch(toolStatusSubs, frame as unknown as ToolStatusFrame);
        return;
      }
      case "reasoning": {
        if (typeof frame.delta !== "string") {
          log.warn("frame_malformed", { type: "reasoning" });
          return;
        }
        if (frame.delta === "") return;
        dispatch(reasoningSubs, frame.delta);
        return;
      }
      case "delegations": {
        if (!Array.isArray(frame.items)) {
          log.warn("frame_malformed", { type: "delegations" });
          return;
        }
        const items = frame.items as DelegationItem[];
        dispatch(delegationSubs, items);
        return;
      }
      default:
        log.debug("frame_unknown", { type: String(frame.type) });
    }
  }

  function scheduleReconnect(code: number): void {
    if (disposed || !active) return;
    // Retrying a key the backend refuses only repeats the refusal; the socket waits for a
    // settings change or an explicit reconnectNow().
    if (code === AUTH_CLOSE_CODE) {
      delayMs = RECONNECT_MIN_MS;
      setState({ kind: "failed", code });
      return;
    }
    const wait = delayMs;
    delayMs = Math.min(delayMs * 2, RECONNECT_MAX_MS);
    setState({ kind: "reconnecting", delay_ms: wait });
    log.info("ws_reconnect", { delay_ms: wait });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      setState({ kind: "connecting" });
      void open();
    }, wait);
  }

  async function open(): Promise<void> {
    let key: string | undefined;
    let socket: WebSocket;
    let url: string;
    opening = true;
    try {
      let mine = epoch;
      key = await deps.getKey();
      // A connect() that arrived during the wait may carry an edited key — read it again rather
      // than opening on the one this attempt started with.
      while (epoch !== mine && !disposed && active) {
        mine = epoch;
        key = await deps.getKey();
      }
      if (disposed || !active) {
        opening = false;
        return;
      }
      url = pushSocketUrl(deps.chatBaseUrl());
      socket = new WS(url);
    } catch (err) {
      // A rejected key or a constructor the platform refuses leaves nothing to close — retry from here.
      opening = false;
      log.warn("ws_open_failed", { error: String(err) });
      ws = null;
      scheduleReconnect(OPEN_FAILED_CODE);
      return;
    }
    opening = false;
    ws = socket;

    // Every handler is guarded on identity: a socket the client has moved on from still fires its
    // events on a later task, and must not touch the state of the one that replaced it.
    socket.onopen = () => {
      if (ws !== socket) return;
      log.info("ws_open", { url });
      const vocabulary = deps.vocabulary();
      sentVocabulary = JSON.stringify(vocabulary);
      sendFrame({ type: "hello", key: key ?? "", chat_id: deps.chatId(), vocabulary });
      readyTimer = setTimeout(() => {
        readyTimer = null;
        log.warn("ws_ready_timeout", { wait_ms: READY_WAIT_MS });
        socket.close(NORMAL_CLOSE_CODE);
      }, READY_WAIT_MS);
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (ws !== socket) return;
      handleFrame(ev.data);
    };

    socket.onclose = (ev: { code: number }) => {
      if (ws !== socket) {
        log.debug("ws_close.stale", { code: ev.code });
        return;
      }
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = null;
      ws = null;
      ready = false;
      sentVocabulary = null;
      log.info("ws_close", { code: ev.code });
      if (disposed || !active) {
        setState({ kind: "disconnected" });
        return;
      }
      scheduleReconnect(ev.code);
    };
  }

  function subscribe<T>(set: Set<T>, cb: T): () => void {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  return {
    connect(): void {
      if (disposed || active) return;
      epoch++;
      // An attempt already between its key lookup and its socket is the one this would start; a
      // disconnect() during that wait is undone here so the single attempt continues instead of
      // a second socket opening behind it.
      if (opening) {
        active = true;
        delayMs = RECONNECT_MIN_MS;
        setState({ kind: "connecting" });
        return;
      }
      // An unconfigured endpoint resolves against the app's own origin, which is never a backend.
      if (!deps.chatBaseUrl().trim()) {
        log.warn("ws_not_configured", { missing: "chat_base_url" });
        setState({ kind: "disconnected" });
        return;
      }
      active = true;
      delayMs = RECONNECT_MIN_MS;
      setState({ kind: "connecting" });
      void open();
    },

    disconnect(): void {
      active = false;
      clearTimers();
      ready = false;
      sentVocabulary = null;
      const socket = ws;
      ws = null;
      socket?.close(NORMAL_CLOSE_CODE);
      setState({ kind: "disconnected" });
    },

    reconnectNow(): void {
      if (disposed || !active) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      // An attempt already in flight is the one this would start.
      if (opening || ws !== null) return;
      setState({ kind: "connecting" });
      void open();
    },

    dispose(): void {
      disposed = true;
      active = false;
      clearTimers();
      renderSubs.clear();
      speechSubs.clear();
      turnEndSubs.clear();
      toolStatusSubs.clear();
      delegationSubs.clear();
      reasoningSubs.clear();
      ws?.close(NORMAL_CLOSE_CODE);
      ws = null;
      ready = false;
      setState({ kind: "disconnected" });
      stateSubs.clear();
    },

    sendTurn(turn): boolean {
      if (!ready) {
        log.warn("turn_not_ready", { turn_id: turn.turn_id, state: state.kind });
        return false;
      }
      return sendFrame({ type: "turn", ...turn });
    },

    sendReset(): boolean {
      if (!ready) {
        log.warn("reset_not_ready", { state: state.kind });
        return false;
      }
      return sendFrame({ type: "reset" });
    },

    sendVocabulary: syncVocabulary,

    onRender: (cb) => subscribe(renderSubs, cb),
    onSpeech: (cb) => subscribe(speechSubs, cb),
    onTurnEnd: (cb) => subscribe(turnEndSubs, cb),
    onToolStatus: (cb) => subscribe(toolStatusSubs, cb),
    onDelegations: (cb) => subscribe(delegationSubs, cb),
    onReasoning: (cb) => subscribe(reasoningSubs, cb),
    onState: (cb) => subscribe(stateSubs, cb),
    getState: () => state,
  };
}
