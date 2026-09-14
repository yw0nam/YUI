/**
 * push-socket — the single WebSocket `chat_api: "push"` runs on.
 *
 * Turns go out on it and finished replies arrive on it, so a reply can arrive without a request.
 * The frames, the limits and the reconnect schedule are defined in docs/reference/push-transport.md.
 * The socket renders no judgment: it validates shape and hands every frame to its subscribers.
 */

import type { ExpressArgs } from "../contract";
import { createLogger, type Logger } from "../logger";
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

/** A finished backend turn. `turn_id` is null when the backend speaks on its own. */
export interface RenderFrame {
  type: "render";
  turn_id: string | null;
  source: string;
  segments: RenderSegment[];
}

/** One piece of work the backend handed to a background worker. */
export interface DelegationItem {
  id: string;
  title: string;
  started_at: number;
  state: "running" | "done";
  ended_at?: number;
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
  dispose(): void;
  /** True when the frame went out; false when the socket is not ready or the frame is too large. */
  sendTurn(turn: PushTurnFrame): boolean;
  sendReset(): boolean;
  /** Sends the current vocabulary when it differs from the one the backend last received. */
  sendVocabulary(): void;
  onRender(cb: (frame: RenderFrame) => void): () => void;
  onDelegations(cb: (items: DelegationItem[]) => void): () => void;
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

/** A render frame the client can act on: an ordered segment list and a source to log. */
function isRenderFrame(v: Record<string, unknown>): boolean {
  return Array.isArray(v.segments) && typeof v.source === "string";
}

export function createPushSocket(deps: PushSocketDeps): PushSocket {
  const log = deps.logger ?? baseLog;
  const WS = deps.WebSocketImpl ?? globalThis.WebSocket;

  const renderSubs = new Set<(frame: RenderFrame) => void>();
  const delegationSubs = new Set<(items: DelegationItem[]) => void>();
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
  /** Set while the last close was the backend rejecting the key — the retries must not read as progress. */
  let authCode: number | null = null;
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
        authCode = null;
        const chatId = typeof frame.chat_id === "string" ? frame.chat_id : deps.chatId();
        log.info("ws_ready", { chat_id: chatId });
        setState({ kind: "ready", chat_id: chatId });
        // The vocabulary may have moved while the handshake was in flight; hello carried the old one.
        syncVocabulary();
        return;
      }
      case "render": {
        if (!isRenderFrame(frame)) {
          log.warn("frame_malformed", { type: "render" });
          return;
        }
        const render = frame as unknown as RenderFrame;
        for (const cb of renderSubs) cb(render);
        return;
      }
      case "delegations": {
        if (!Array.isArray(frame.items)) {
          log.warn("frame_malformed", { type: "delegations" });
          return;
        }
        const items = frame.items as DelegationItem[];
        for (const cb of delegationSubs) cb(items);
        return;
      }
      default:
        log.debug("frame_unknown", { type: String(frame.type) });
    }
  }

  function scheduleReconnect(code: number): void {
    if (disposed || !active) return;
    const wait = delayMs;
    delayMs = Math.min(delayMs * 2, RECONNECT_MAX_MS);
    authCode = code === AUTH_CLOSE_CODE ? code : null;
    setState(
      authCode !== null
        ? { kind: "failed", code: authCode }
        : { kind: "reconnecting", delay_ms: wait },
    );
    log.info("ws_reconnect", { delay_ms: wait });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // A rejected key stays rejected until a ready says otherwise — retrying is not progress.
      if (authCode === null) setState({ kind: "connecting" });
      void open();
    }, wait);
  }

  async function open(): Promise<void> {
    let key: string | undefined;
    let socket: WebSocket;
    let url: string;
    try {
      key = await deps.getKey();
      if (disposed || !active) return;
      url = pushSocketUrl(deps.chatBaseUrl());
      socket = new WS(url);
    } catch (err) {
      // A rejected key or a constructor the platform refuses leaves nothing to close — retry from here.
      log.warn("ws_open_failed", { error: String(err) });
      ws = null;
      scheduleReconnect(OPEN_FAILED_CODE);
      return;
    }
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
      // An unconfigured endpoint resolves against the app's own origin, which is never a backend.
      if (!deps.chatBaseUrl().trim()) {
        log.warn("ws_not_configured", { missing: "chat_base_url" });
        setState({ kind: "disconnected" });
        return;
      }
      active = true;
      delayMs = RECONNECT_MIN_MS;
      authCode = null;
      setState({ kind: "connecting" });
      void open();
    },

    disconnect(): void {
      active = false;
      clearTimers();
      ready = false;
      sentVocabulary = null;
      authCode = null;
      const socket = ws;
      ws = null;
      socket?.close(NORMAL_CLOSE_CODE);
      setState({ kind: "disconnected" });
    },

    dispose(): void {
      disposed = true;
      active = false;
      clearTimers();
      renderSubs.clear();
      delegationSubs.clear();
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
    onDelegations: (cb) => subscribe(delegationSubs, cb),
    onState: (cb) => subscribe(stateSubs, cb),
    getState: () => state,
  };
}
