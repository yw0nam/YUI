/**
 * push-socket.test.ts — the one WebSocket `chat_api: "push"` runs on.
 *
 * Covers the handshake, the reconnect schedule, the outbound frames and the inbound dispatch
 * described in docs/reference/push-transport.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger";
import {
  createPushSocket,
  PUSH_FRAME_MAX_BYTES,
  type PushSocket,
  type PushVocabulary,
  pushSocketUrl,
  pushVocabularyOf,
  type RenderFrame,
} from "./push-socket";

interface Frame {
  type: string;
  [key: string]: unknown;
}

/** Stand-in for the browser WebSocket: every instance stays reachable so a test can drive it. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static last(): FakeSocket {
    const s = FakeSocket.instances.at(-1);
    if (!s) throw new Error("no socket was opened");
    return s;
  }

  static deferClose = false;

  readonly sent: string[] = [];
  closedWith: number | null = null;
  pendingClose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.closedWith !== null) return;
    this.closedWith = code;
    // A real WebSocket fires onclose on a later task. Deferring it here lets a test place that
    // event after the socket that replaced this one is already open.
    if (FakeSocket.deferClose) this.pendingClose = () => this.onclose?.({ code });
    else this.onclose?.({ code });
  }

  /** Delivers a close deferred by `deferClose`. */
  settleClose(): void {
    const pending = this.pendingClose;
    this.pendingClose = null;
    pending?.();
  }

  /** The server accepted the connection. */
  accept(): void {
    this.onopen?.();
  }

  /** The server pushed one frame. */
  push(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  /** The server (or the network) dropped the connection. */
  drop(code = 1006): void {
    if (this.closedWith !== null) return;
    this.closedWith = code;
    this.onclose?.({ code });
  }

  frames(): Frame[] {
    return this.sent.map((s) => JSON.parse(s) as Frame);
  }
}

const VOCAB: PushVocabulary = {
  emotion_ids: ["neutral", "happy"],
  motion_ids: ["idle"],
  emotion_text_mode: "enum",
  emotion_text_map: { "😆": "joyfully" },
};

let logger: Logger;
let vocabulary: PushVocabulary;
let chatBaseUrl: string;
let socket: PushSocket;

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function build(overrides: Partial<Parameters<typeof createPushSocket>[0]> = {}): PushSocket {
  return createPushSocket({
    chatBaseUrl: () => chatBaseUrl,
    chatId: () => "yui-3f9a2c1d",
    getKey: async () => "secret-key",
    vocabulary: () => vocabulary,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    logger,
    ...overrides,
  });
}

/** Connects and completes the handshake, leaving the socket ready. */
async function connected(overrides?: Partial<Parameters<typeof createPushSocket>[0]>) {
  socket = build(overrides);
  socket.connect();
  await vi.advanceTimersByTimeAsync(0);
  FakeSocket.last().accept();
  FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  FakeSocket.deferClose = false;
  logger = makeLogger();
  vocabulary = { ...VOCAB };
  chatBaseUrl = "http://localhost:8646";
});

afterEach(() => {
  socket?.dispose();
  vi.useRealTimers();
});

describe("pushSocketUrl", () => {
  it("gives wss://host:8646/ws for an https base", () => {
    expect(pushSocketUrl("https://host:8646")).toBe("wss://host:8646/ws");
  });

  it("gives ws://…/ws for an http base and keeps the base path", () => {
    expect(pushSocketUrl("http://localhost:8643/v1")).toBe("ws://localhost:8643/v1/ws");
  });

  it("collapses trailing slashes on the base", () => {
    expect(pushSocketUrl("http://localhost:8646//")).toBe("ws://localhost:8646/ws");
  });
});

describe("createPushSocket — handshake", () => {
  it("opens the socket at the /ws URL and sends hello first", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.last().url).toBe("ws://localhost:8646/ws");
    FakeSocket.last().accept();

    expect(FakeSocket.last().frames()).toEqual([
      {
        type: "hello",
        key: "secret-key",
        chat_id: "yui-3f9a2c1d",
        vocabulary: VOCAB,
      },
    ]);
  });

  it("reports ready once the backend answers, and logs ws_open and ws_ready", async () => {
    await connected();

    expect(socket.getState()).toEqual({ kind: "ready", chat_id: "yui-3f9a2c1d" });
    expect(logger.info).toHaveBeenCalledWith("ws_open", { url: "ws://localhost:8646/ws" });
    expect(logger.info).toHaveBeenCalledWith("ws_ready", { chat_id: "yui-3f9a2c1d" });
  });

  it("is connecting between connect() and ready", async () => {
    socket = build();
    socket.connect();
    expect(socket.getState()).toEqual({ kind: "connecting" });
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    expect(socket.getState()).toEqual({ kind: "connecting" });
  });

  it("closes and reconnects when ready does not arrive within 10 s", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(FakeSocket.last().closedWith).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances[0]!.closedWith).toBe(1000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("reads the chat endpoint again on every attempt, so an edited URL lands on the next one", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.last().url).toBe("ws://localhost:8646/ws");

    chatBaseUrl = "https://agent.example:9000";
    FakeSocket.last().drop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeSocket.last().url).toBe("wss://agent.example:9000/ws");
  });

  it("notifies state subscribers on every transition", async () => {
    const seen: unknown[] = [];
    socket = build();
    socket.onState((s) => seen.push(s));
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });

    expect(seen).toEqual([{ kind: "connecting" }, { kind: "ready", chat_id: "yui-3f9a2c1d" }]);
  });
});

describe("createPushSocket — reconnect", () => {
  it("waits 1 s, then doubles up to a 30 s cap", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      FakeSocket.last().drop();
      const state = socket.getState();
      if (state.kind === "reconnecting") delays.push(state.delay_ms);
      await vi.advanceTimersByTimeAsync(state.kind === "reconnecting" ? state.delay_ms : 0);
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it("logs ws_close with the code and ws_reconnect with the delay", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().drop(1006);

    expect(logger.info).toHaveBeenCalledWith("ws_close", { code: 1006 });
    expect(logger.info).toHaveBeenCalledWith("ws_reconnect", { delay_ms: 1_000 });
  });

  it("resets the delay to 1 s after a ready", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    FakeSocket.last().drop();
    await vi.advanceTimersByTimeAsync(2_000);

    FakeSocket.last().accept();
    FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });
    FakeSocket.last().drop();

    expect(socket.getState()).toEqual({ kind: "reconnecting", delay_ms: 1_000 });
  });

  it("stops retrying after a wrong-key close", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().drop(4401);

    expect(socket.getState()).toEqual({ kind: "failed", code: 4401 });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("sends no second hello while the key stands rejected", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    const rejected = FakeSocket.last();
    rejected.drop(4401);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(rejected.sent).toHaveLength(1);
    expect(FakeSocket.instances.flatMap((s) => s.sent)).toHaveLength(1);
  });

  it("opens again when a settings change reopens it", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().drop(4401);

    socket.disconnect();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(socket.getState()).toEqual({ kind: "connecting" });
  });

  it("clears the wrong-key state once the backend accepts the key", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().drop(4401);

    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });

    expect(socket.getState()).toEqual({ kind: "ready", chat_id: "yui-3f9a2c1d" });
  });

  it("dispose() closes the socket and stops reconnecting", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    socket.dispose();

    expect(FakeSocket.last().closedWith).toBe(1000);
    expect(socket.getState()).toEqual({ kind: "disconnected" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("createPushSocket — reconnectNow", () => {
  it("opens at once from the wrong-key state", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().drop(4401);

    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(socket.getState()).toEqual({ kind: "connecting" });
  });

  it("carries the key as it stands when it opens", async () => {
    let key = "old-key";
    socket = build({ getKey: async () => key });
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    FakeSocket.last().drop(4401);

    key = "new-key";
    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();

    expect(JSON.parse(FakeSocket.last().sent[0]!).key).toBe("new-key");
  });

  it("skips the wait a backoff had already armed", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().drop(1006);
    expect(socket.getState()).toEqual({ kind: "reconnecting", delay_ms: 1_000 });

    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(socket.getState()).toEqual({ kind: "connecting" });
  });

  it("leaves no armed timer behind, so the skipped wait opens nothing later", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().drop(1006);

    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("opens one socket when it is asked twice before the key resolves", async () => {
    let releaseKey!: (key: string) => void;
    const pendingKey = new Promise<string>((resolve) => {
      releaseKey = resolve;
    });
    socket = build({ getKey: () => pendingKey });
    socket.connect();

    socket.reconnectNow();
    socket.reconnectNow();
    releaseKey("secret-key");
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("does nothing while the socket is already up", async () => {
    await connected();

    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.getState()).toEqual({ kind: "ready", chat_id: "yui-3f9a2c1d" });
  });

  it("does nothing once disconnected", async () => {
    await connected();
    socket.disconnect();

    socket.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.getState()).toEqual({ kind: "disconnected" });
  });
});

describe("createPushSocket — refusing to open", () => {
  it("stays disconnected when no chat endpoint is configured", async () => {
    chatBaseUrl = "";
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toEqual([]);
    expect(socket.getState()).toEqual({ kind: "disconnected" });
    expect(logger.warn).toHaveBeenCalledWith("ws_not_configured", expect.anything());
  });

  it("treats a whitespace-only chat endpoint as none at all", async () => {
    chatBaseUrl = "   ";
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toEqual([]);
    expect(socket.getState()).toEqual({ kind: "disconnected" });
  });

  it("schedules a retry when the WebSocket constructor throws", async () => {
    class ThrowingSocket {
      constructor() {
        throw new Error("insecure connection");
      }
    }
    socket = build({ WebSocketImpl: ThrowingSocket as unknown as typeof WebSocket });
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.getState()).toEqual({ kind: "reconnecting", delay_ms: 1_000 });
    expect(logger.warn).toHaveBeenCalledWith("ws_open_failed", expect.anything());
  });

  it("schedules a retry when the key cannot be resolved", async () => {
    socket = build({
      getKey: async () => {
        throw new Error("keychain locked");
      },
    });
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toEqual([]);
    expect(socket.getState()).toEqual({ kind: "reconnecting", delay_ms: 1_000 });
  });

  it("retries after a failed attempt on the same doubling schedule", async () => {
    class ThrowingSocket {
      constructor() {
        throw new Error("insecure connection");
      }
    }
    socket = build({ WebSocketImpl: ThrowingSocket as unknown as typeof WebSocket });
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.getState()).toEqual({ kind: "reconnecting", delay_ms: 2_000 });
  });
});

describe("createPushSocket — disconnect", () => {
  it("closes the open socket and stays down", async () => {
    await connected();
    socket.disconnect();

    expect(FakeSocket.last().closedWith).toBe(1000);
    expect(socket.getState()).toEqual({ kind: "disconnected" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("cancels a reconnect already waiting", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().drop();
    expect(socket.getState()).toEqual({ kind: "reconnecting", delay_ms: 1_000 });

    socket.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.getState()).toEqual({ kind: "disconnected" });
  });

  it("refuses turns once disconnected", async () => {
    await connected();
    socket.disconnect();

    expect(socket.sendTurn({ turn_id: "7", client_context: "", text: "hi" })).toBe(false);
  });

  it("opens again on a later connect, with the endpoint as it stands then", async () => {
    await connected();
    socket.disconnect();

    chatBaseUrl = "https://agent.example:9000";
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.last().url).toBe("wss://agent.example:9000/ws");
  });

  it("keeps the socket a reopen just opened when the old one closes a task later", async () => {
    FakeSocket.deferClose = true;
    await connected();
    const abandoned = FakeSocket.last();

    socket.disconnect();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    const fresh = FakeSocket.last();
    expect(fresh).not.toBe(abandoned);
    fresh.accept();
    fresh.push({ type: "ready", chat_id: "yui-3f9a2c1d" });

    // The close of the socket left behind by the reopen lands only now.
    abandoned.settleClose();

    expect(socket.getState()).toEqual({ kind: "ready", chat_id: "yui-3f9a2c1d" });
    expect(socket.sendTurn({ turn_id: "7", client_context: "", text: "hi" })).toBe(true);
    expect(fresh.frames().at(-1)).toMatchObject({ type: "turn" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("leaves the new handshake's deadline running when the old socket closes late", async () => {
    FakeSocket.deferClose = true;
    await connected();
    const abandoned = FakeSocket.last();

    socket.disconnect();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();
    abandoned.settleClose();

    // The replacement never hears a ready, so its own deadline must still close it.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances[1]!.closedWith).toBe(1000);
  });

  it("ignores a late open from a socket the reopen left behind", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    const abandoned = FakeSocket.last();

    socket.disconnect();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    abandoned.accept();

    expect(abandoned.sent).toEqual([]);
  });

  it("is inert when nothing is open", () => {
    socket = build();
    expect(() => socket.disconnect()).not.toThrow();
    expect(socket.getState()).toEqual({ kind: "disconnected" });
  });

  it("opens one socket when a disconnect and a connect race the key lookup", async () => {
    let releaseKey!: (key: string) => void;
    const pendingKey = new Promise<string>((resolve) => {
      releaseKey = resolve;
    });
    socket = build({ getKey: () => pendingKey });
    socket.connect();
    socket.disconnect();
    socket.connect();
    releaseKey("secret-key");
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.last().accept();
    FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });
    expect(socket.getState()).toEqual({ kind: "ready", chat_id: "yui-3f9a2c1d" });
  });

  it("opens with the key the reconnecting window asked for, not the one already in flight", async () => {
    const keys = ["old", "new"];
    const getKey = vi.fn(async () => keys.shift());
    let releaseKey!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseKey = resolve;
    });
    socket = build({
      getKey: async () => {
        const key = await getKey();
        if (key === "old") await held;
        return key;
      },
    });
    socket.connect();
    socket.disconnect();
    socket.connect();
    releaseKey();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.last().accept();
    expect(FakeSocket.last().frames()[0]!.key).toBe("new");
  });

  it("ignores a second connect while one is already in flight", async () => {
    socket = build();
    socket.connect();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("createPushSocket — outbound frames", () => {
  it("sends a turn frame once ready", async () => {
    await connected();
    expect(
      socket.sendTurn({
        turn_id: "7",
        client_context: "<client_context>\nx\n</client_context>",
        text: "hi",
      }),
    ).toBe(true);

    expect(FakeSocket.last().frames().at(-1)).toEqual({
      type: "turn",
      turn_id: "7",
      client_context: "<client_context>\nx\n</client_context>",
      text: "hi",
    });
  });

  it("refuses a turn before ready and sends nothing", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();

    expect(socket.sendTurn({ turn_id: "7", client_context: "", text: "hi" })).toBe(false);
    expect(
      FakeSocket.last()
        .frames()
        .map((f) => f.type),
    ).toEqual(["hello"]);
  });

  it("sends a reset frame once ready and refuses one before", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sendReset()).toBe(false);

    FakeSocket.last().accept();
    FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });
    expect(socket.sendReset()).toBe(true);
    expect(FakeSocket.last().frames().at(-1)).toEqual({ type: "reset" });
  });

  it("sends a vocabulary frame when the renderable set changed", async () => {
    await connected();
    vocabulary = { ...VOCAB, motion_ids: ["idle", "dance"] };
    socket.sendVocabulary();

    expect(FakeSocket.last().frames().at(-1)).toEqual({
      type: "vocabulary",
      vocabulary: { ...VOCAB, motion_ids: ["idle", "dance"] },
    });
  });

  it("sends nothing when the vocabulary is unchanged", async () => {
    await connected();
    socket.sendVocabulary();
    expect(
      FakeSocket.last()
        .frames()
        .map((f) => f.type),
    ).toEqual(["hello"]);
  });

  it("sends a vocabulary that changed while the handshake was still in flight", async () => {
    socket = build();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last().accept();

    vocabulary = { ...VOCAB, motion_ids: ["idle", "dance"] };
    FakeSocket.last().push({ type: "ready", chat_id: "yui-3f9a2c1d" });

    expect(FakeSocket.last().frames().at(-1)).toEqual({
      type: "vocabulary",
      vocabulary: { ...VOCAB, motion_ids: ["idle", "dance"] },
    });
  });

  it("sends no vocabulary frame on a ready whose hello already carried it", async () => {
    await connected();
    expect(
      FakeSocket.last()
        .frames()
        .map((f) => f.type),
    ).toEqual(["hello"]);
  });

  it("carries the vocabulary current at reconnect time in the new hello", async () => {
    await connected();
    vocabulary = { ...VOCAB, emotion_ids: ["neutral"] };
    FakeSocket.last().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    FakeSocket.last().accept();

    expect(FakeSocket.last().frames()[0]).toMatchObject({
      type: "hello",
      vocabulary: { ...VOCAB, emotion_ids: ["neutral"] },
    });
  });

  it("drops an outbound frame over the size cap instead of sending it", async () => {
    await connected();
    const huge = "x".repeat(PUSH_FRAME_MAX_BYTES);

    expect(socket.sendTurn({ turn_id: "7", client_context: huge, text: "" })).toBe(false);
    expect(
      FakeSocket.last()
        .frames()
        .map((f) => f.type),
    ).toEqual(["hello"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "frame_oversize",
      expect.objectContaining({ type: "turn" }),
    );
  });
});

describe("createPushSocket — inbound frames", () => {
  const RENDER = {
    type: "render",
    turn_id: "7",
    source: "hermes",
    segments: [
      { cues: [{ emotion_id: "happy" }], speech: "All green." },
      { cues: [], speech: "Want the list?" },
    ],
  };

  it("hands a render frame to every subscriber", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push(RENDER);

    expect(seen).toEqual([RENDER]);
  });

  it("stops delivering after the subscription is dropped", async () => {
    await connected();
    const seen: unknown[] = [];
    const off = socket.onRender((frame) => seen.push(frame));
    off();
    FakeSocket.last().push(RENDER);

    expect(seen).toEqual([]);
  });

  it("hands a delegations frame's items to every subscriber", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onDelegations((items) => seen.push(items));
    const items = [{ id: "d-1", title: "Sort the list", started_at: 1, state: "running" }];
    FakeSocket.last().push({ type: "delegations", items });

    expect(seen).toEqual([items]);
  });

  it("ignores a frame that is not JSON", async () => {
    await connected();
    socket.onRender(() => {
      throw new Error("must not fire");
    });
    expect(() => FakeSocket.last().push("not json")).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith("frame_parse_failed", expect.anything());
  });

  it("ignores a frame over the size cap", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push(JSON.stringify({ ...RENDER, source: "x".repeat(PUSH_FRAME_MAX_BYTES) }));

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_oversize", expect.anything());
  });

  it("ignores a render frame whose segments are missing", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push({ type: "render", turn_id: "7", source: "hermes" });

    expect(seen).toEqual([]);
  });

  it("ignores a render frame whose turn_id is not a string", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push({ ...RENDER, turn_id: 7 });

    expect(seen).toEqual([]);
  });

  it("drops a render frame whose turn_id is null", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    const frame: Record<string, unknown> = { ...RENDER };
    frame.turn_id = null;
    FakeSocket.last().push(frame);

    expect(seen).toEqual([]);
  });

  it("ignores a render frame carrying a segment that is not an object", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push({ ...RENDER, segments: [null] });

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", {
      type: "render",
      field: "segments",
    });
  });

  it.each([
    ["not a list", { cues: 5 }],
    ["a list holding a list", { cues: [[]] }],
  ])("ignores a render frame whose cues are %s", async (_label, segment) => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push({ ...RENDER, segments: [segment] });

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", {
      type: "render",
      field: "segments",
    });
  });

  it("a throwing subscriber is logged and the others still run", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender(() => {
      throw new Error("the stage is on fire");
    });
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push(RENDER);

    expect(seen).toEqual([RENDER]);
    expect(logger.warn).toHaveBeenCalledWith("subscriber_failed", expect.anything());
  });

  it("names the field that made a render frame unreadable", async () => {
    await connected();
    FakeSocket.last().push({ ...RENDER, turn_id: 7 });

    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", {
      type: "render",
      field: "turn_id",
    });
  });

  it("hands a turn_end frame to every subscriber", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onTurnEnd((frame) => seen.push(frame));
    FakeSocket.last().push({ type: "turn_end", turn_id: "7" });

    expect(seen).toEqual([{ type: "turn_end", turn_id: "7" }]);
  });

  it("drops a turn_end frame whose turn_id is not a string", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onTurnEnd((frame) => seen.push(frame));
    FakeSocket.last().push({ type: "turn_end", turn_id: 5 });

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", {
      type: "turn_end",
      field: "turn_id",
    });
  });

  it("ignores a frame type it does not know", async () => {
    await connected();
    expect(() => FakeSocket.last().push({ type: "weather" })).not.toThrow();
  });

  it("hands a reasoning frame's delta to every subscriber", async () => {
    await connected();
    const seen: string[] = [];
    socket.onReasoning((delta) => seen.push(delta));
    FakeSocket.last().push({ type: "reasoning", delta: "The log is the first place to look." });

    expect(seen).toEqual(["The log is the first place to look."]);
  });

  it("stops delivering reasoning after the subscription is dropped", async () => {
    await connected();
    const seen: string[] = [];
    const off = socket.onReasoning((delta) => seen.push(delta));
    off();
    FakeSocket.last().push({ type: "reasoning", delta: "late" });

    expect(seen).toEqual([]);
  });

  it("warns and drops a reasoning frame whose delta is not a string", async () => {
    await connected();
    const seen: string[] = [];
    socket.onReasoning((delta) => seen.push(delta));
    FakeSocket.last().push({ type: "reasoning", delta: 5 });

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", { type: "reasoning" });
  });

  it("delivers nothing for an empty-string reasoning delta", async () => {
    await connected();
    const seen: string[] = [];
    socket.onReasoning((delta) => seen.push(delta));
    FakeSocket.last().push({ type: "reasoning", delta: "" });

    expect(seen).toEqual([]);
  });

  it("carries a render frame's reasoning field through to subscribers", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push({ ...RENDER, reasoning: "thought so" });

    expect(seen).toEqual([{ ...RENDER, reasoning: "thought so" }]);
  });

  it("removes a non-string reasoning field from a render frame before publishing", async () => {
    await connected();
    const seen: RenderFrame[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push({ ...RENDER, reasoning: 5 });

    expect(seen).toHaveLength(1);
    expect("reasoning" in seen[0]!).toBe(false);
  });
});

describe("createPushSocket — speech frames", () => {
  const SPEECH = {
    type: "speech",
    turn_id: "7",
    segments: [{ cues: [{ emotion_id: "happy" }], speech: "All green." }],
  };

  it("hands a speech frame to every subscriber", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onSpeech((frame) => seen.push(frame));
    socket.onSpeech((frame) => seen.push(frame));
    FakeSocket.last().push(SPEECH);

    expect(seen).toEqual([SPEECH, SPEECH]);
  });

  it("hands a speech frame to no render subscriber", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onRender((frame) => seen.push(frame));
    FakeSocket.last().push(SPEECH);

    expect(seen).toEqual([]);
  });

  it("stops delivering speech after the subscription is dropped", async () => {
    await connected();
    const seen: unknown[] = [];
    const off = socket.onSpeech((frame) => seen.push(frame));
    off();
    FakeSocket.last().push(SPEECH);

    expect(seen).toEqual([]);
  });

  it("drops a speech frame whose turn_id is not a string", async () => {
    await connected();
    const seen: unknown[] = [];
    socket.onSpeech((frame) => seen.push(frame));
    FakeSocket.last().push({ ...SPEECH, turn_id: 7 });

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", {
      type: "speech",
      field: "turn_id",
    });
  });

  it.each([
    ["missing", undefined],
    ["holding a segment that is not an object", [null]],
    ["holding cues that are not a list", [{ cues: 5, speech: "Hi." }]],
    ["holding speech that is not text", [{ speech: 5 }]],
  ])("drops a speech frame whose segments are %s", async (_label, segments) => {
    await connected();
    const seen: unknown[] = [];
    socket.onSpeech((frame) => seen.push(frame));
    FakeSocket.last().push({ ...SPEECH, segments });

    expect(seen).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("frame_malformed", {
      type: "speech",
      field: "segments",
    });
  });
});

describe("pushVocabularyOf", () => {
  it("maps the published broker payload to the frame's vocabulary", () => {
    expect(
      pushVocabularyOf({
        emotionIds: ["neutral", "happy"],
        motionIds: ["idle"],
        emotionText: { mode: "enum", table: { "\u{1F606}": "joyfully" } },
      }),
    ).toEqual(VOCAB);
  });

  it("renders nothing when no vocabulary has been published yet", () => {
    expect(pushVocabularyOf(undefined)).toEqual({
      emotion_ids: [],
      motion_ids: [],
      emotion_text_mode: "free",
      emotion_text_map: {},
    });
  });

  it("treats an absent emotion_text table as an empty one", () => {
    expect(
      pushVocabularyOf({
        emotionIds: [],
        motionIds: [],
        emotionText: { mode: "free", table: null },
      }).emotion_text_map,
    ).toEqual({});
  });
});
