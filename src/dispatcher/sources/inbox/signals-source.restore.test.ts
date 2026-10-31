import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { avatarFixture } from "../../../config/load-test-helpers";
import type { SignalGroup } from "../../../contract";
import type { SignalsBatch } from "../../../io/bridge/inbox/signals-inbox";
import type { OsEventListen, OsEventPayload } from "../../../io/window/tauri-listen";
import type { BackendCaller, TurnOutcome } from "../../backend/backend-caller";
import { type BusEnvelope, createEventBus } from "../../core/event-bus";
import { createGuardrails } from "../../core/guardrails";
import { composePacedPipelineBusy } from "../../core/paced-pipeline-busy";
import { createProactivePacer } from "../../core/proactive-pacer";
import { createDispatcher } from "../../dispatcher";
import {
  createDefaultAddressedChain,
  makeLogger,
  NOW,
  permissiveGuardrailsConfig,
  SIGNAL_ENVELOPE,
} from "../../test-helpers";
import { createTurnLog } from "../../turn/turn";
import { createMilestoneSource } from "../idle-tick/milestone-source";
import { createProactiveSource } from "../idle-tick/proactive-source";
import { createSignalsSource, type SignalsSource } from "./signals-source";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

it("restores signals after a failed milestone turn is dropped", async () => {
  const handlers = new Set<(event: { payload: OsEventPayload }) => void>();
  const listen: OsEventListen = async (_event, handler) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };
  const tick = (os_idle_ms: number) => {
    for (const handler of handlers)
      handler({ payload: { event_name: "os_idle_tick", ts: Date.now(), data: { os_idle_ms } } });
  };
  const milestoneHandlers = new Set<(event: { payload: OsEventPayload }) => void>();
  const milestoneListen: OsEventListen = async (_event, handler) => {
    milestoneHandlers.add(handler);
    return () => {
      milestoneHandlers.delete(handler);
    };
  };
  let acceptSignals: ((event: SignalsBatch) => void) | undefined;
  const bus = createEventBus();
  const pacer = createProactivePacer({ getIntervalMs: () => 600_000 });
  const call = vi.fn<BackendCaller["call"]>(async (): Promise<TurnOutcome> => "network_drop");
  let signalsSource: SignalsSource;
  const dispatcher = createDispatcher({
    bus,
    peekConfig: () => avatarFixture().peek,
    tapConfig: () => avatarFixture().tap,
    pacer,
    backendCaller: { call },
    guardrails: createGuardrails(permissiveGuardrailsConfig()),
    turnLog: createTurnLog(),
    renderer: {} as never,
    hasOutstandingSpeech: () => false,
    addressedChain: createDefaultAddressedChain(),
    logger: makeLogger(),
    onTurnDropped: (env) => signalsSource.restore(env),
  });
  const pipelineBusy = {
    isBusy: dispatcher.isPipelineBusy,
    subscribe: dispatcher.subscribePipelineBusy,
  };
  const paced = composePacedPipelineBusy({ pipelineBusy, pacer });
  signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: 10_000,
    isEnabled: () => true,
    listen,
    onInbox: (cb) => {
      acceptSignals = cb;
      return () => {};
    },
    isPipelineBusy: paced.isBusy,
    subscribePipelineBusy: paced.subscribe,
    isUrgentPipelineBusy: pipelineBusy.isBusy,
    subscribeUrgentPipelineBusy: pipelineBusy.subscribe,
  });
  await signalsSource.start();
  dispatcher.start();
  tick(20_000);
  const group: SignalGroup = { envelope: SIGNAL_ENVELOPE, items: [{ message: "ready" }] };
  acceptSignals?.({ signals: group.items, envelope: group.envelope, ts: NOW });
  const milestone = createMilestoneSource({
    bus,
    present_max_idle_ms: 10_000,
    isEnabled: () => true,
    drainSignals: signalsSource.drain,
    firedStorage: { load: () => ({}), save: () => {} },
    listen: milestoneListen,
  });
  await milestone.start();
  for (const handler of milestoneHandlers)
    handler({ payload: { event_name: "os_idle_tick", ts: Date.now(), data: { os_idle_ms: 500 } } });
  await vi.advanceTimersByTimeAsync(50);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![0].trigger.event_name).toBe("time_milestone.first_activity");
  expect(
    dispatcher.recentDrops().map(({ event_name, reason }) => ({ event_name, reason })),
  ).toEqual([{ event_name: "time_milestone.first_activity", reason: "network_drop" }]);
  expect(signalsSource.drain()).toEqual([group]);
  dispatcher.stop();
  signalsSource.stop();
  milestone.stop();
  pacer.stop();
});

it("restores a signals catch-up dropped at the global gap", async () => {
  const handlers = new Set<(event: { payload: OsEventPayload }) => void>();
  const listen: OsEventListen = async (_event, handler) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };
  const tick = (os_idle_ms: number) => {
    for (const handler of handlers)
      handler({ payload: { event_name: "os_idle_tick", ts: Date.now(), data: { os_idle_ms } } });
  };
  let acceptSignals: ((event: SignalsBatch) => void) | undefined;
  const bus = createEventBus();
  const pacer = createProactivePacer({ getIntervalMs: () => 600_000 });
  const call = vi.fn<BackendCaller["call"]>(async (): Promise<TurnOutcome> => "ok");
  let signalsSource: SignalsSource;
  const dispatcher = createDispatcher({
    bus,
    peekConfig: () => avatarFixture().peek,
    tapConfig: () => avatarFixture().tap,
    pacer,
    backendCaller: { call },
    guardrails: createGuardrails(permissiveGuardrailsConfig()),
    turnLog: createTurnLog(),
    renderer: {} as never,
    hasOutstandingSpeech: () => false,
    addressedChain: createDefaultAddressedChain(),
    logger: makeLogger(),
    onTurnDropped: (env) => signalsSource.restore(env),
  });
  const pipelineBusy = {
    isBusy: dispatcher.isPipelineBusy,
    subscribe: dispatcher.subscribePipelineBusy,
  };
  const paced = composePacedPipelineBusy({ pipelineBusy, pacer });
  const proactive = createProactiveSource({
    bus,
    present_max_idle_ms: 10_000,
    getCues: () => [{ id: "mid_check", label: "mid", context: "", idle_min: 1, enabled: true }],
    isEnabled: () => true,
    listen,
  });
  signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: 10_000,
    isEnabled: () => true,
    listen,
    onInbox: (cb) => {
      acceptSignals = cb;
      return () => {};
    },
    isPipelineBusy: paced.isBusy,
    subscribePipelineBusy: paced.subscribe,
    isUrgentPipelineBusy: pipelineBusy.isBusy,
    subscribeUrgentPipelineBusy: pipelineBusy.subscribe,
  });
  await proactive.start();
  await signalsSource.start();
  dispatcher.start();
  tick(20_000);
  vi.setSystemTime(NOW + 120_000);
  const group: SignalGroup = { envelope: SIGNAL_ENVELOPE, items: [{ message: "ready" }] };
  acceptSignals?.({ signals: group.items, envelope: group.envelope, ts: NOW + 120_000 });
  tick(100);
  await vi.advanceTimersByTimeAsync(50);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![0].trigger.event_name).toBe("proactive.mid_check");
  expect(
    dispatcher.recentDrops().map(({ event_name, reason }) => ({ event_name, reason })),
  ).toEqual([{ event_name: "signals.catchup", reason: "global_gap" }]);
  expect(signalsSource.drain()).toEqual([group]);
  dispatcher.stop();
  proactive.stop();
  signalsSource.stop();
  pacer.stop();
});

const envelopeOf = (id: number) => ({ ...SIGNAL_ENVELOPE, event_id: `run-${id}` });

function setupRestore() {
  const pushed: BusEnvelope[] = [];
  const handlers = new Set<(event: { payload: OsEventPayload }) => void>();
  const listen: OsEventListen = async (_event, handler) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };
  let acceptSignals: ((event: SignalsBatch) => void) | undefined;
  const src = createSignalsSource({
    bus: {
      push: (env) => {
        pushed.push(env);
        return true;
      },
    },
    present_max_idle_ms: 10_000,
    isEnabled: () => true,
    listen,
    onInbox: (cb) => {
      acceptSignals = cb;
      return () => {};
    },
  });
  return {
    src,
    pushed,
    emitIdle: (os_idle_ms: number) => {
      for (const handler of handlers)
        handler({ payload: { event_name: "os_idle_tick", ts: NOW, data: { os_idle_ms } } });
    },
    emitInbox: (group: SignalGroup) =>
      acceptSignals?.({ envelope: group.envelope, signals: group.items, ts: NOW }),
  };
}

it("restores groups ahead of existing groups by delivery and keeps newer duplicates", async () => {
  const s = setupRestore();
  await s.src.start();
  s.emitIdle(20_000);
  const firstBatched = { envelope: envelopeOf(1), items: [{ id: 1 }] };
  const secondBatched = {
    envelope: { ...envelopeOf(2), delivery: "batched" as const },
    items: [{ id: 2 }],
  };
  s.emitInbox(firstBatched);
  s.emitInbox(secondBatched);
  const bufferedUrgent = {
    envelope: { ...envelopeOf(6), delivery: "urgent" as const },
    items: [{ id: 6 }],
  };
  s.emitInbox(bufferedUrgent);
  const urgent = {
    envelope: { ...envelopeOf(3), delivery: "urgent" as const },
    items: [{ id: 3 }],
  };
  const restoredBatch = {
    envelope: { ...envelopeOf(4), delivery: "batched" as const },
    items: [{ id: 4 }],
  };
  const thirdBatched = { envelope: envelopeOf(5), items: [{ id: 5 }] };
  s.src.restore({
    source: "timer_scheduler",
    event_name: "signals.catchup",
    ts: NOW,
    payload: {
      signals: [urgent, restoredBatch, thirdBatched, { ...firstBatched, items: [{ id: 99 }] }],
    },
  });
  s.emitIdle(100);
  expect(s.pushed.map((env) => [env.event_name, env.payload?.signals])).toEqual([
    ["signals.catchup", [restoredBatch, thirdBatched, firstBatched, secondBatched]],
    ["signals.urgent_catchup", [urgent, bufferedUrgent]],
  ]);
  s.src.stop();
});

it("restoring a batched group into an empty buffer arms delivery", async () => {
  const s = setupRestore();
  await s.src.start();
  s.emitIdle(100);
  const group = {
    envelope: { ...SIGNAL_ENVELOPE, delivery: "batched" as const },
    items: [{ id: 1 }],
  };
  s.src.restore({
    source: "timer_scheduler",
    event_name: "signals.batch",
    ts: NOW,
    payload: { signals: [group] },
  });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(s.pushed.map((env) => [env.event_name, env.payload?.signals])).toEqual([
    ["signals.batch", [group]],
  ]);
  s.src.stop();
});
