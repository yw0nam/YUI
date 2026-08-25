/**
 * broker-client.test.ts — Expression Broker MCP write-only client.
 *
 * Covers: createBrokerClient({ baseUrl, fetch?, logger?, pollIntervalMs?, setInterval?, clearInterval? }).
 *   A stateless, best-effort writer. getIds()/publish() — MCP streamable-http (initialize → notifications/initialized → tools/call).
 *   Responses use SSE framing (`event: message\ndata: {json}`); result.content[0].text is a JSON string (JSON.parse).
 *   D4: no transport failure ever throws (warn, then degrade). D7: publish is idempotent + re-published on liveness poll.
 *
 * deriveBrokerPayload: AppConfig → BrokerPayload (pure, no I/O).
 *
 * Tests use only an injected fake fetch — no real broker connection.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type AppConfig,
  ATTACHMENT_LIMITS_DEFAULTS,
  DRAG_HOLD_MS_DEFAULT,
  GESTURE_CUES_DEFAULTS,
  PEEK_DEFAULTS,
  TAP_DEFAULTS,
} from "../config/load";
import type { MotionRegistry } from "../contract";
import type { Logger } from "../logger";
import {
  agentTriggerableMotionIds,
  type BrokerPayload,
  type BrokerVocab,
  createBrokerClient,
  deriveBrokerPayload,
} from "./broker-client";

type FetchFn = (input: unknown, init?: RequestInit) => Promise<Response>;

const BASE = "http://localhost:3201/mcp";

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** SSE-framed Response with an mcp-session-id header. */
function sseResponse(envelope: unknown, sessionId = "sess-1"): Response {
  const headers = new Headers();
  headers.set("content-type", "text/event-stream");
  headers.set("mcp-session-id", sessionId);
  return {
    ok: true,
    status: 200,
    headers,
    text: async () => `event: message\ndata: ${JSON.stringify(envelope)}\n\n`,
  } as unknown as Response;
}

/** 202/empty for the notifications/initialized notification. */
function acceptedResponse(): Response {
  return {
    ok: true,
    status: 202,
    headers: new Headers(),
    text: async () => "",
  } as unknown as Response;
}

/** tools/call result envelope — payload is a JSON string in content[0].text. */
function toolResult(id: number, payload: unknown, isError = false): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError,
    },
  };
}

/** initialize result envelope. */
function initResult(id: number): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "broker" } },
  };
}

interface ScriptedCall {
  body: Record<string, unknown>;
}

/**
 * Builds a fake fetch that walks the MCP handshake. `vocab` is what get_ids returns;
 * update_* tools echo {ok:true, version}. Records every JSON-RPC body for assertions.
 */
function scriptedFetch(vocab: BrokerVocab): {
  fetch: ReturnType<typeof vi.fn<FetchFn>>;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  const fetch = vi.fn<FetchFn>(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    const method = body.method as string;
    const id = body.id as number;
    if (method === "initialize") return sseResponse(initResult(id));
    if (method === "notifications/initialized") return acceptedResponse();
    if (method === "tools/call") {
      const params = body.params as { name: string };
      if (params.name === "get_ids") return sseResponse(toolResult(id, vocab));
      // update_* tools
      return sseResponse(toolResult(id, { ok: true, version: vocab.version + 1 }));
    }
    throw new Error(`unexpected method ${method}`);
  });
  return { fetch, calls };
}

function toolNames(calls: ScriptedCall[]): string[] {
  return calls
    .filter((c) => c.body.method === "tools/call")
    .map((c) => (c.body.params as { name: string }).name);
}

const SAMPLE_VOCAB: BrokerVocab = {
  emotion_ids: ["neutral", "happy"],
  motion_ids: ["idle", "happy"],
  emotion_text_mode: "free",
  emotion_text_map: {},
  version: 5,
};

describe("getIds", () => {
  it("parses SSE → content[0].text → JSON into BrokerVocab", async () => {
    const { fetch } = scriptedFetch(SAMPLE_VOCAB);
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    const vocab = await client.getIds();
    expect(vocab).toEqual(SAMPLE_VOCAB);
  });

  it("returns null on HTTP error (no throw escapes)", async () => {
    const fetch = vi.fn<FetchFn>(async () => {
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => "",
      } as unknown as Response;
    });
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await expect(client.getIds()).resolves.toBeNull();
  });

  it("returns null on malformed SSE (no data line)", async () => {
    const fetch = vi.fn<FetchFn>(async (_i: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (body.method === "initialize") return sseResponse(initResult(body.id as number));
      if (body.method === "notifications/initialized") return acceptedResponse();
      const h = new Headers();
      h.set("mcp-session-id", "sess-1");
      return {
        ok: true,
        status: 200,
        headers: h,
        text: async () => "garbage no data line",
      } as unknown as Response;
    });
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await expect(client.getIds()).resolves.toBeNull();
  });

  it("returns null when fetch throws (network down)", async () => {
    const fetch = vi.fn<FetchFn>(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await expect(client.getIds()).resolves.toBeNull();
  });

  it("sends initialize then notifications/initialized then get_ids reusing the session id", async () => {
    const { fetch, calls } = scriptedFetch(SAMPLE_VOCAB);
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await client.getIds();
    expect(calls.map((c) => c.body.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    // initialized + tools/call carry the captured session header
    const headersOf = (i: number) =>
      (fetch.mock.calls[i][1]?.headers ?? {}) as Record<string, string>;
    expect(headersOf(1)["mcp-session-id"]).toBe("sess-1");
    expect(headersOf(2)["mcp-session-id"]).toBe("sess-1");
  });
});

describe("publish idempotency", () => {
  it("issues no update_* calls when getIds already matches the payload", async () => {
    const vocab: BrokerVocab = {
      emotion_ids: ["neutral", "happy"],
      motion_ids: ["idle", "happy"],
      emotion_text_mode: "free",
      emotion_text_map: {},
      version: 1,
    };
    const { fetch, calls } = scriptedFetch(vocab);
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    // payload identical (order-insensitive)
    await client.publish({
      emotionIds: ["happy", "neutral"],
      motionIds: ["happy", "idle"],
      emotionText: { mode: "free", table: null },
    });
    expect(toolNames(calls)).toEqual(["get_ids"]);
  });

  it("issues only update_emotion_ids when emotion ids differ", async () => {
    const vocab: BrokerVocab = {
      emotion_ids: ["neutral"],
      motion_ids: ["idle", "happy"],
      emotion_text_mode: "free",
      emotion_text_map: {},
      version: 1,
    };
    const { fetch, calls } = scriptedFetch(vocab);
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await client.publish({
      emotionIds: ["neutral", "happy"],
      motionIds: ["idle", "happy"],
      emotionText: { mode: "free", table: null },
    });
    expect(toolNames(calls)).toEqual(["get_ids", "update_emotion_ids"]);
  });

  it("issues only update_motion_ids when motion ids differ", async () => {
    const vocab: BrokerVocab = {
      emotion_ids: ["neutral"],
      motion_ids: ["idle"],
      emotion_text_mode: "free",
      emotion_text_map: {},
      version: 1,
    };
    const { fetch, calls } = scriptedFetch(vocab);
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await client.publish({
      emotionIds: ["neutral"],
      motionIds: ["idle", "happy"],
      emotionText: { mode: "free", table: null },
    });
    expect(toolNames(calls)).toEqual(["get_ids", "update_motion_ids"]);
  });

  it("issues update_emotion_text when mode/table differ", async () => {
    const vocab: BrokerVocab = {
      emotion_ids: ["neutral"],
      motion_ids: ["idle"],
      emotion_text_mode: "free",
      emotion_text_map: {},
      version: 1,
    };
    const { fetch, calls } = scriptedFetch(vocab);
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await client.publish({
      emotionIds: ["neutral"],
      motionIds: ["idle"],
      emotionText: { mode: "enum", table: { "😀": "happy" } },
    });
    expect(toolNames(calls)).toEqual(["get_ids", "update_emotion_text"]);
    const call = calls.find(
      (c) =>
        c.body.method === "tools/call" &&
        (c.body.params as { name: string }).name === "update_emotion_text",
    )!;
    const args = (call.body.params as { arguments: unknown }).arguments;
    expect(args).toEqual({ mode: "enum", table: { "😀": "happy" } });
  });

  // A user toggling motion switches fires publishes faster than a round trip completes. Overlapping
  // publishes would each diff against the same pre-change snapshot and race on the wire, so the
  // broker can settle on the earlier list until the next liveness poll (20s) corrects it.
  it("serializes overlapping publishes — the second diffs against what the first left behind", async () => {
    const state: BrokerVocab = {
      emotion_ids: ["neutral"],
      motion_ids: ["idle"],
      emotion_text_mode: "free",
      emotion_text_map: {},
      version: 1,
    };
    const calls: ScriptedCall[] = [];
    const fetch = vi.fn<FetchFn>(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ body });
      const id = body.id as number;
      if (body.method === "initialize") return sseResponse(initResult(id));
      if (body.method === "notifications/initialized") return acceptedResponse();
      const params = body.params as { name: string; arguments: { ids?: string[] } };
      if (params.name === "get_ids") return sseResponse(toolResult(id, { ...state }));
      if (params.name === "update_motion_ids") {
        state.motion_ids = params.arguments.ids!;
        state.version += 1;
      }
      return sseResponse(toolResult(id, { ok: true, version: state.version }));
    });
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    const payload = (motionIds: string[]): BrokerPayload => ({
      emotionIds: ["neutral"],
      motionIds,
      emotionText: { mode: "free", table: null },
    });

    await Promise.all([
      client.publish(payload(["idle", "happy"])),
      client.publish(payload(["idle", "happy", "dance"])),
    ]);

    expect(toolNames(calls)).toEqual([
      "get_ids",
      "update_motion_ids",
      "get_ids",
      "update_motion_ids",
    ]);
    expect(state.motion_ids).toEqual(["idle", "happy", "dance"]);
  });

  it("never rejects even when fetch throws, and logs a warn", async () => {
    const fetch = vi.fn<FetchFn>(async () => {
      throw new Error("ECONNREFUSED");
    });
    const logger = silentLogger();
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger });
    await expect(
      client.publish({
        emotionIds: ["neutral"],
        motionIds: ["idle"],
        emotionText: { mode: "free", table: null },
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("attempts all updates when getIds returns null (fresh/restarted broker)", async () => {
    // initialize fails on the FIRST rpc cycle (the get_ids cycle), succeeds afterwards.
    let cycle = 0;
    const calls: ScriptedCall[] = [];
    const fetch = vi.fn<FetchFn>(async (_i: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ body });
      if (body.method === "initialize") {
        cycle += 1;
        if (cycle === 1) {
          return {
            ok: false,
            status: 503,
            headers: new Headers(),
            text: async () => "",
          } as unknown as Response;
        }
        return sseResponse(initResult(body.id as number));
      }
      if (body.method === "notifications/initialized") return acceptedResponse();
      return sseResponse(toolResult(body.id as number, { ok: true, version: 2 }));
    });
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });
    await client.publish({
      emotionIds: ["neutral"],
      motionIds: ["idle"],
      emotionText: { mode: "free", table: null },
    });
    const names = toolNames(calls);
    expect(names).toContain("update_emotion_ids");
    expect(names).toContain("update_motion_ids");
    expect(names).toContain("update_emotion_text");
  });
});

describe("liveness poll", () => {
  it("re-publishes the last payload when broker version regresses", async () => {
    // start with a high version, then have getIds report a lower one → restart inferred.
    let version = 10;
    const calls: ScriptedCall[] = [];
    const fetch = vi.fn<FetchFn>(async (_i: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ body });
      const id = body.id as number;
      if (body.method === "initialize") return sseResponse(initResult(id));
      if (body.method === "notifications/initialized") return acceptedResponse();
      const params = body.params as { name: string };
      if (params.name === "get_ids") {
        return sseResponse(
          toolResult(id, {
            emotion_ids: ["neutral"],
            motion_ids: ["idle"],
            emotion_text_mode: "free",
            emotion_text_map: {},
            version,
          }),
        );
      }
      return sseResponse(toolResult(id, { ok: true, version }));
    });

    let captured: (() => void) | null = null;
    const fakeSetInterval = vi.fn((cb: () => void) => {
      captured = cb;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const fakeClearInterval = vi.fn();

    const client = createBrokerClient({
      baseUrl: BASE,
      fetch,
      logger: silentLogger(),
      setInterval: fakeSetInterval as unknown as typeof setInterval,
      clearInterval: fakeClearInterval as unknown as typeof clearInterval,
    });

    const payload: BrokerPayload = {
      emotionIds: ["neutral"],
      motionIds: ["idle"],
      emotionText: { mode: "free", table: null },
    };
    await client.publish(payload); // observes version 10, ids match → no updates
    expect(toolNames(calls)).toEqual(["get_ids"]);

    client.start();
    expect(fakeSetInterval).toHaveBeenCalledOnce();

    // broker restarted: version dropped
    version = 2;
    calls.length = 0;
    await captured!();
    // poll's getIds sees regressed version → re-publish lastPayload (ids still match so updates may be skipped,
    // but the re-publish cycle must run get_ids again at minimum)
    expect(toolNames(calls)).toContain("get_ids");

    client.stop();
    expect(fakeClearInterval).toHaveBeenCalled();
  });

  it("stop() clears the timer and prevents further polls", async () => {
    const { fetch } = scriptedFetch(SAMPLE_VOCAB);
    const fakeClearInterval = vi.fn();
    const fakeSetInterval = vi.fn(() => 7 as unknown as ReturnType<typeof setInterval>);
    const client = createBrokerClient({
      baseUrl: BASE,
      fetch,
      logger: silentLogger(),
      setInterval: fakeSetInterval as unknown as typeof setInterval,
      clearInterval: fakeClearInterval as unknown as typeof clearInterval,
    });
    client.start();
    client.stop();
    expect(fakeClearInterval).toHaveBeenCalledWith(7);
  });
});

/**
 * The publish queue's own failure modes. Serialization made publish a queue, and a queue can be
 * wedged, outlive its client, or carry a payload the poller no longer recognizes as current.
 */
describe("publish queue", () => {
  const payload = (motionIds: string[]): BrokerPayload => ({
    emotionIds: ["neutral"],
    motionIds,
    emotionText: { mode: "free", table: null },
  });

  /** Broker stuck at motion_ids:["idle"], so every publish diffs and every poll sees drift. */
  function staticBroker(): {
    fetch: ReturnType<typeof vi.fn<FetchFn>>;
    calls: ScriptedCall[];
    updatedIds: () => string[][];
    gate: { hold(): void; release(): void };
  } {
    const calls: ScriptedCall[] = [];
    let held: Promise<void> | null = null;
    let releaseHeld: (() => void) | null = null;
    const fetch = vi.fn<FetchFn>(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ body });
      const id = body.id as number;
      if (body.method === "initialize") {
        if (held) {
          const wait = held;
          held = null;
          await wait;
        }
        return sseResponse(initResult(id));
      }
      if (body.method === "notifications/initialized") return acceptedResponse();
      const params = body.params as { name: string };
      if (params.name === "get_ids") {
        return sseResponse(
          toolResult(id, {
            emotion_ids: ["neutral"],
            motion_ids: ["idle"],
            emotion_text_mode: "free",
            emotion_text_map: {},
            version: 1,
          }),
        );
      }
      return sseResponse(toolResult(id, { ok: true, version: 2 }));
    });
    return {
      fetch,
      calls,
      updatedIds: () =>
        calls
          .filter(
            (c) =>
              c.body.method === "tools/call" &&
              (c.body.params as { name: string }).name === "update_motion_ids",
          )
          .map((c) => (c.body.params as { arguments: { ids: string[] } }).arguments.ids),
      gate: {
        hold() {
          held = new Promise<void>((resolve) => {
            releaseHeld = resolve;
          });
        },
        release() {
          releaseHeld?.();
        },
      },
    };
  }

  // publishNow rejecting is meant to be impossible, but the chain is built on that assumption and
  // nothing pins it. A throwing logger reaches the one warn publishNow makes outside rpc's catch.
  it("keeps the queue alive after a publish rejects", async () => {
    const { fetch, calls } = staticBroker();
    const logger = silentLogger();
    let explode = true;
    logger.warn = vi.fn(() => {
      if (!explode) return;
      explode = false;
      throw new Error("logger exploded");
    });
    // update_not_ok fires the throwing warn — the broker answers ok:true, so force a non-ok reply.
    const okFalseFetch = vi.fn<FetchFn>(async (input: unknown, init?: RequestInit) => {
      const res = await fetch(input, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const name = (body.params as { name?: string } | undefined)?.name;
      if (name && name !== "get_ids") {
        return sseResponse(toolResult(body.id as number, { ok: false }));
      }
      return res;
    });
    const client = createBrokerClient({ baseUrl: BASE, fetch: okFalseFetch, logger });

    await expect(client.publish(payload(["idle", "happy"]))).rejects.toThrow("logger exploded");
    calls.length = 0;
    await client.publish(payload(["idle", "dance"]));

    expect(toolNames(calls)).toContain("update_motion_ids");
  });

  // The reconciler disposes the old client when broker_base_url changes. Anything still queued
  // would keep writing the new vocabulary to the broker the user just moved away from.
  it("dispose drops publishes that have not reached the wire", async () => {
    const { fetch, calls } = staticBroker();
    const client = createBrokerClient({ baseUrl: BASE, fetch, logger: silentLogger() });

    const first = client.publish(payload(["idle", "happy"]));
    const second = client.publish(payload(["idle", "dance"]));
    client.dispose();
    await Promise.all([first, second]);

    expect(calls).toEqual([]);
  });

  // wireBroker's boot does `publish(payload).then(() => broker?.start())`. Disposing inside that
  // window still armed the poll, and poll's own get_ids reaches the wire regardless of the queue —
  // a retired client kept talking to the old broker every 20s for the life of the process.
  it("start() after dispose never arms the poll", async () => {
    const { fetch } = staticBroker();
    const setIntervalImpl = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>);
    const client = createBrokerClient({
      baseUrl: BASE,
      fetch,
      logger: silentLogger(),
      setInterval: setIntervalImpl as unknown as typeof setInterval,
      clearInterval: (() => {}) as unknown as typeof clearInterval,
    });

    const publishing = client.publish(payload(["idle", "happy"]));
    client.dispose();
    await publishing;
    client.start();

    expect(setIntervalImpl).not.toHaveBeenCalled();
  });

  // lastPayload is what poll() republishes on drift. Recorded when a publish *executes*, it names
  // the older payload while a newer one waits in the queue — so a poll landing in that window
  // enqueues a stale republish behind the fresh one. The broker settles stale, and lastPayload is
  // stale too, so the next poll sees no drift: the user's selection is lost until restart.
  it("republishes the newest enqueued payload, not the one still executing", async () => {
    const { fetch, updatedIds, gate } = staticBroker();
    let tick: (() => void) | undefined;
    const client = createBrokerClient({
      baseUrl: BASE,
      fetch,
      logger: silentLogger(),
      setInterval: ((cb: () => void) => {
        tick = cb;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearInterval: (() => {}) as unknown as typeof clearInterval,
    });
    client.start();

    gate.hold();
    const first = client.publish(payload(["idle", "happy"]));
    const second = client.publish(payload(["idle", "dance"]));
    // Let the first publish reach the gated initialize, leaving the second queued behind it.
    await Promise.resolve();
    await Promise.resolve();

    const polled = (async () => tick?.())();
    // The poll's own get_ids runs ungated and detects drift while the first publish is still held.
    await Promise.resolve();
    await Promise.resolve();
    gate.release();
    await Promise.all([first, second, polled]);

    expect(updatedIds().at(-1)).toEqual(["idle", "dance"]);
  });
});

describe("agentTriggerableMotionIds", () => {
  function motions(): MotionRegistry {
    return {
      idle: {
        vrma_path: "/motions/idle.vrma",
        kind: "ambient",
        loop: true,
        priority: 10,
        interrupt_policy: "ignore",
      },
      drag: {
        vrma_path: "/motions/drag.vrma",
        kind: "reactive",
        loop: false,
        priority: 50,
        interrupt_policy: "replace",
      },
      happy: {
        vrma_path: "/motions/happy.vrma",
        kind: "oneshot",
        loop: false,
        priority: 60,
        interrupt_policy: "replace",
      },
      sit: {
        vrma_path: "/motions/sit.vrma",
        kind: "oneshot",
        loop: false,
        priority: 60,
        interrupt_policy: "replace",
        broker_publish: false,
      },
      window_sit: {
        vrma_path: "/motions/sit_01.vrma",
        kind: "state",
        loop: true,
        priority: 55,
        interrupt_policy: "replace",
        broker_publish: false,
      },
    };
  }

  it("excludes reactive, ambient, and broker_publish:false motions", () => {
    const ids = agentTriggerableMotionIds(motions());
    expect(ids).not.toContain("drag");
    expect(ids).not.toContain("idle");
    expect(ids).not.toContain("sit");
    expect([...ids].sort()).toEqual(["happy"]);
  });

  it("excludes a kind:state motion solely via broker_publish:false (window_sit)", () => {
    const ids = agentTriggerableMotionIds(motions());
    expect(ids).not.toContain("window_sit");
  });

  it("returns an empty array for an empty registry", () => {
    expect(agentTriggerableMotionIds({})).toEqual([]);
  });
});

/** The selection is a required argument; most cases exercise it deselecting nothing. */
const NONE_DESELECTED = { expressMotions: { disabled: [] } };

describe("deriveBrokerPayload", () => {
  function baseConfig(): AppConfig {
    return {
      endpoints: {
        chat_base_url: "http://localhost:8643",
        chat_endpoint: "/v1/responses",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
      },
      avatar: {
        vrm_url: "/vrms/carlotta.vrm",
        peek: PEEK_DEFAULTS,
        tap: TAP_DEFAULTS,
        drag_hold_ms: DRAG_HOLD_MS_DEFAULT,
        gesture_cues: GESTURE_CUES_DEFAULTS,
      },
      emotionRegistry: {
        neutral: { vrm_expression: "neutral", fallback: "neutral" },
        happy: { vrm_expression: "happy", fallback: "neutral" },
      },
      motions: {
        idle: {
          vrma_path: "/motions/idle.vrma",
          kind: "ambient",
          loop: true,
          priority: 10,
          interrupt_policy: "ignore",
        },
        drag: {
          vrma_path: "/motions/drag.vrma",
          kind: "reactive",
          loop: false,
          priority: 50,
          interrupt_policy: "replace",
        },
        happy: {
          vrma_path: "/motions/happy.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
        },
        laugh: {
          vrma_path: "/motions/laugh.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
        },
        embarrassed: {
          vrma_path: "/motions/embarrassed.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
        },
        sit: {
          vrma_path: "/motions/sit.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
          broker_publish: false,
        },
        window_sit: {
          vrma_path: "/motions/sit_01.vrma",
          kind: "state",
          loop: true,
          priority: 55,
          interrupt_policy: "replace",
          broker_publish: false,
        },
      },
      guardrails: {
        debounce_ms: {
          idle_watcher: 0,
          os_event_watcher: 0,
          backend_push_source: 0,
          user_input_source: 0,
          screen_watcher: 5000,
        },
        rate_limit: { window_ms: 0, tier2_max: 0, tier3_max: 0, overall_max: 0, cooldown_ms: 0 },
        attachments: ATTACHMENT_LIMITS_DEFAULTS,
      },
      filler: {
        gap_ms: 0,
        gap_jitter_ms: 0,
        max_repeats: 3,
        gap_growth: 2,
        long_wait_ms: 40000,
        pools: {},
      },
      hotkeys: { summon_global: "" },
      screen: {
        prev_dwell_ms: 600000,
        settle_ms: 90000,
        long_session_ms: 2700000,
        min_gap_ms: 300000,
        quiet_after_turn_ms: 180000,
        recent_cap: 5,
      },
    };
  }

  it("derives emotion ids from registry keys", () => {
    const p = deriveBrokerPayload(baseConfig(), null, NONE_DESELECTED);
    expect([...p.emotionIds].sort()).toEqual(["happy", "neutral"]);
  });

  it("excludes reactive, ambient, and broker_publish:false motions (drops drag/idle/sit, keeps happy/laugh/embarrassed)", () => {
    const p = deriveBrokerPayload(baseConfig(), null, NONE_DESELECTED);
    expect(p.motionIds).not.toContain("drag");
    expect(p.motionIds).not.toContain("idle");
    expect(p.motionIds).not.toContain("sit");
    expect([...p.motionIds].sort()).toEqual(["embarrassed", "happy", "laugh"]);
  });

  it("excludes a kind:state motion solely via broker_publish:false (window_sit)", () => {
    const p = deriveBrokerPayload(baseConfig(), null, NONE_DESELECTED);
    expect(p.motionIds).not.toContain("window_sit");
  });

  it("a table → enum + that table", () => {
    const table = { "😀": "happy", "😢": "sad" };
    const p = deriveBrokerPayload(baseConfig(), table, NONE_DESELECTED);
    expect(p.emotionText).toEqual({ mode: "enum", table });
  });

  it("a null table → free + null + warn (no crash)", () => {
    const logger = silentLogger();
    const p = deriveBrokerPayload(baseConfig(), null, { ...NONE_DESELECTED, logger });
    expect(p.emotionText).toEqual({ mode: "free", table: null });
    expect(logger.warn).toHaveBeenCalled();
  });

  // The user's expression-motion selection narrows the published vocabulary at this one derive
  // site, so both consumers — the broker publish and the CC generate_express schema — follow it.
  describe("expression-motion selection", () => {
    it("publishes the whole agent-triggerable set when nothing is deselected", () => {
      const p = deriveBrokerPayload(baseConfig(), null, {
        expressMotions: { disabled: [] },
      });
      expect([...p.motionIds].sort()).toEqual(["embarrassed", "happy", "laugh"]);
    });

    it("drops a deselected motion from motionIds", () => {
      const p = deriveBrokerPayload(baseConfig(), null, {
        expressMotions: { disabled: ["laugh"] },
      });
      expect(p.motionIds).toEqual(["happy", "embarrassed"]);
    });

    it("publishes an empty motion list when every motion is deselected", () => {
      const p = deriveBrokerPayload(baseConfig(), null, {
        expressMotions: { disabled: ["happy", "laugh", "embarrassed"] },
      });
      expect(p.motionIds).toEqual([]);
    });

    it("keeps a catalog motion the selection has never heard of — additions arrive enabled", () => {
      const cfg = baseConfig();
      cfg.motions.wave = {
        vrma_path: "/motions/wave.vrma",
        kind: "oneshot",
        loop: false,
        priority: 60,
        interrupt_policy: "replace",
      };
      const p = deriveBrokerPayload(cfg, null, { expressMotions: { disabled: ["laugh"] } });
      expect(p.motionIds).toContain("wave");
    });

    it("leaves emotion ids untouched — the selection curates motions only", () => {
      const p = deriveBrokerPayload(baseConfig(), null, {
        expressMotions: { disabled: ["happy", "laugh", "embarrassed"] },
      });
      expect([...p.emotionIds].sort()).toEqual(["happy", "neutral"]);
    });
  });
});
