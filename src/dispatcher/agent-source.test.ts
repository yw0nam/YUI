/**
 * agent-source.test.ts — agent completion firing source.
 *
 * Locks the event-driven (inbox) + presence-gated state model:
 *  1. present at inbox arrival → immediate agent.done; payload has tool/project/cwd/summary/ts.
 *  2. away at inbox arrival → buffers per tool (nothing pushed).
 *  3. idle→present edge → exactly ONE agent.catchup; count + items in ts order; buffer cleared.
 *  4. subsequent present ticks emit nothing further (guard: edge not level).
 *  5. buffer cap: >5 per tool drops oldest.
 *  6. !isEnabled() → inbox events are dropped silently.
 *  7. malformed or null payload does not crash.
 *  8. start() idempotent; stop() safe off-Tauri (listen: undefined).
 *
 * All deps injected (fakeBus / fakeInbox / fakeListen / clock) — no network, no Tauri.
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentDone } from "../io/agent-inbox";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { createAgentSource } from "./agent-source";
import type { BusEnvelope, EventBus } from "./event-bus";

const PRESENT_MAX = 10_000;
const LOW_IDLE = 500; // present
const HIGH_IDLE = PRESENT_MAX + 1; // away

function fakeBus(): { bus: Pick<EventBus, "push">; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: Pick<EventBus, "push"> = {
    push: vi.fn((e: BusEnvelope) => {
      pushed.push(e);
      return true;
    }),
  };
  return { bus, pushed };
}

function fakeListen(): { listen: OsEventListen; emit: (p: OsEventPayload) => void } {
  let handler: ((e: { payload: OsEventPayload }) => void) | undefined;
  const listen: OsEventListen = vi.fn(async (_event, h) => {
    handler = h;
    return vi.fn();
  });
  return { listen, emit: (payload) => handler?.({ payload }) };
}

function idleTick(os_idle_ms: number | null, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

type OnInboxFn = (cb: (p: AgentDone) => void, deps?: { listen?: OsEventListen }) => () => void;

function fakeInbox(): { onInbox: OnInboxFn; emit: (p: AgentDone) => void } {
  let handler: ((p: AgentDone) => void) | undefined;
  const onInbox: OnInboxFn = vi.fn((cb) => {
    handler = cb;
    return vi.fn();
  });
  return { onInbox, emit: (p) => handler?.(p) };
}

function done(
  tool: string,
  project = "my-project",
  ts = 1000,
  status?: "success" | "error",
): AgentDone {
  return { tool, project, cwd: `/home/user/${project}`, status, summary: `${tool} completed`, ts };
}

describe("agent_source — present: immediate agent.done (spec §1)", () => {
  it("inbox arrival while present → pushes agent.done with correct envelope fields", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const now = vi.fn(() => 9000);

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      now,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(done("claude-code", "widget", 8500, "success"));

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("agent.done");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.payload).toMatchObject({
      tool: "claude-code",
      project: "widget",
      cwd: "/home/user/widget",
      status: "success",
      summary: "claude-code completed",
      ts: 8500,
    });

    src.stop();
  });

  it("status undefined is omitted from the agent.done payload (optional field)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(done("opencode", "proj")); // no status

    expect(pushed).toHaveLength(1);
    expect("status" in (pushed[0].payload ?? {})).toBe(false);

    src.stop();
  });
});

describe("agent_source — away: buffer + catch-up (spec §2–3)", () => {
  it("away: inbox events are buffered (nothing pushed); present tick → ONE agent.catchup; buffer cleared", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    // Away — two completions.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(done("claude-code", "alpha", 1000));
    emitInbox(done("claude-code", "beta", 2000));
    expect(pushed).toHaveLength(0);

    // Present tick → catch-up.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.event_name).toBe("agent.catchup");
    expect(e.source).toBe("timer_scheduler");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    const p = e.payload as { count: number; items: unknown[] };
    expect(p.count).toBe(2);
    expect(p.items).toHaveLength(2);
    // Items in ts ascending order (oldest first).
    const items = p.items as Array<{ tool: string; project: string; ts: number }>;
    expect(items[0]).toMatchObject({ tool: "claude-code", project: "alpha", ts: 1000 });
    expect(items[1]).toMatchObject({ tool: "claude-code", project: "beta", ts: 2000 });

    // Buffer cleared — another present tick emits nothing further.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);

    src.stop();
  });

  it("catchup items across multiple tools are flattened and sorted by ts", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(done("tool-a", "proj-a", 3000));
    emitInbox(done("tool-b", "proj-b", 1000));
    emitInbox(done("tool-a", "proj-a2", 2000));

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const items = (pushed[0].payload as { items: Array<{ ts: number }> }).items;
    // sorted oldest→newest by ts
    expect(items.map((i) => i.ts)).toEqual([1000, 2000, 3000]);

    src.stop();
  });

  it("catchup items do NOT include cwd (cwd is live-only)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(done("claude-code", "proj", 1000));

    emitIdle(idleTick(LOW_IDLE));
    const items = (pushed[0].payload as { items: Array<Record<string, unknown>> }).items;
    expect("cwd" in items[0]).toBe(false);

    src.stop();
  });

  it("present→present ticks do NOT re-fire an already-cleared buffer", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(done("claude-code"));
    emitIdle(idleTick(LOW_IDLE)); // flush
    const countAfterFlush = pushed.length;
    emitIdle(idleTick(LOW_IDLE)); // second present tick — nothing buffered
    emitIdle(idleTick(LOW_IDLE)); // third
    expect(pushed).toHaveLength(countAfterFlush);

    src.stop();
  });
});

describe("agent_source — buffer cap 5 per tool (spec §5)", () => {
  it("keeps only the last 5 buffered entries per tool (drops oldest)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    // Push 7 completions for the same tool (ts 10,20,...,70).
    for (let i = 1; i <= 7; i++) {
      emitInbox(done("claude-code", "proj", i * 10));
    }
    expect(pushed).toHaveLength(0); // all away → all buffered (capped)

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { count: number; items: Array<{ ts: number }> };
    // Only last 5 survive (indices 2..6, ts 30..70).
    expect(p.count).toBe(5);
    expect(p.items.map((i) => i.ts)).toEqual([30, 40, 50, 60, 70]);

    src.stop();
  });
});

describe("agent_source — isEnabled gate (spec §6)", () => {
  it("!isEnabled() → inbox arrival is dropped without buffering", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => false,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(done("claude-code"));
    expect(pushed).toHaveLength(0);

    // Even after enabling-like present tick, no catchup fires (nothing was buffered).
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(0);

    src.stop();
  });

  it("mid-run toggle race: buffered while enabled, disabled before return → NO catchup dispatched", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    let enabled = true;

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => enabled,
      onInbox,
      listen,
    });
    await src.start();

    // Away — completions land while enabled and are buffered.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(done("claude-code", "alpha", 1000));
    emitInbox(done("claude-code", "beta", 2000));
    expect(pushed).toHaveLength(0);

    // Toggle disabled before the user returns.
    enabled = false;

    // Present tick — catchup must NOT fire because isEnabled() is now false.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(0);

    src.stop();
  });

  it("mid-away disable drops the stale buffer, so a later re-enable+return only surfaces new items", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    let enabled = true;

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => enabled,
      onInbox,
      listen,
    });
    await src.start();

    // Away — two completions buffered while enabled.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(done("claude-code", "alpha", 1000));
    emitInbox(done("claude-code", "beta", 2000));
    expect(pushed).toHaveLength(0);

    // Disable mid-away.
    enabled = false;
    // Next tick (still away) — the stale buffer must be dropped.
    emitIdle(idleTick(HIGH_IDLE));

    // Re-enable while still away, then a new completion arrives.
    enabled = true;
    emitInbox(done("claude-code", "gamma", 3000));

    // Return to present — exactly ONE catchup, containing only the new item.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { count: number; items: Array<{ project: string }> };
    expect(p.count).toBe(1);
    expect(p.items[0]).toMatchObject({ project: "gamma" });

    src.stop();
  });
});

function fakePipelineBusy(initialBusy: boolean): {
  isPipelineBusy: () => boolean;
  subscribePipelineBusy: (cb: (busy: boolean) => void) => () => void;
  setBusy: (busy: boolean) => void;
} {
  let current = initialBusy;
  let cb: ((busy: boolean) => void) | undefined;
  return {
    isPipelineBusy: () => current,
    subscribePipelineBusy: vi.fn((c: (busy: boolean) => void) => {
      cb = c;
      return vi.fn();
    }),
    setBusy: (busy: boolean) => {
      current = busy;
      cb?.(busy);
    },
  };
}

describe("agent_source — pipeline-busy buffering (spec §2b/#451)", () => {
  it("present + busy: inbox arrival buffers (no agent.done fired)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const pipelineBusy = fakePipelineBusy(true);

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: pipelineBusy.isPipelineBusy,
      subscribePipelineBusy: pipelineBusy.subscribePipelineBusy,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE)); // present
    emitInbox(done("claude-code", "widget", 1000));
    expect(pushed).toHaveLength(0);

    src.stop();
  });

  it("busy→idle edge (subscribePipelineBusy callback fires false) flushes ONE agent.catchup, ts-ordered, buffer cleared", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const pipelineBusy = fakePipelineBusy(true);

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: pipelineBusy.isPipelineBusy,
      subscribePipelineBusy: pipelineBusy.subscribePipelineBusy,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE)); // present, but busy
    emitInbox(done("claude-code", "alpha", 2000));
    emitInbox(done("claude-code", "beta", 1000));
    expect(pushed).toHaveLength(0);

    // busy → idle edge.
    pipelineBusy.setBusy(false);

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.event_name).toBe("agent.catchup");
    const p = e.payload as { count: number; items: Array<{ project: string; ts: number }> };
    expect(p.count).toBe(2);
    expect(p.items.map((i) => i.project)).toEqual(["beta", "alpha"]); // ts ascending

    // A second busy→idle edge with an empty buffer fires nothing further.
    pipelineBusy.setBusy(true);
    pipelineBusy.setBusy(false);
    expect(pushed).toHaveLength(1);

    src.stop();
  });

  it("present + idle (isPipelineBusy: () => false): fires immediately (existing behavior preserved)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: () => false,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(done("claude-code", "widget", 1000));
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("agent.done");

    src.stop();
  });
});

describe("agent_source — malformed payload (spec §7)", () => {
  it("null or undefined payload does not crash", async () => {
    const { bus } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    expect(() => emitInbox(null as unknown as AgentDone)).not.toThrow();
    expect(() => emitInbox(undefined as unknown as AgentDone)).not.toThrow();
    expect(() => emitInbox({} as unknown as AgentDone)).not.toThrow();

    src.stop();
  });
});

describe("agent_source — lifecycle (spec §8)", () => {
  it("start() is idempotent (calling twice does not double-subscribe)", async () => {
    const { bus } = fakeBus();
    const { listen } = fakeListen();
    const { onInbox } = fakeInbox();

    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await expect(src.start()).resolves.toBeUndefined();
    await expect(src.start()).resolves.toBeUndefined();
    // onInbox should have been called exactly once (idempotent).
    expect(vi.mocked(onInbox)).toHaveBeenCalledTimes(1);

    src.stop();
  });

  it("stop() is safe off-Tauri (listen: undefined) and safe to call twice", async () => {
    const { bus } = fakeBus();
    const src = createAgentSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      listen: undefined,
    });
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
    expect(() => src.stop()).not.toThrow();
  });
});
