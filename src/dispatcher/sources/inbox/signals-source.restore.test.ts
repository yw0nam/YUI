import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { avatarFixture } from "../../../config/load-test-helpers";
import type { SignalGroup } from "../../../contract";
import type { AgentEvent } from "../../../io/bridge/inbox/agent-inbox";
import type { SignalsBatch } from "../../../io/bridge/inbox/signals-inbox";
import type { OsEventListen, OsEventPayload } from "../../../io/window/tauri-listen";
import type { BackendCaller, TurnOutcome } from "../../backend/backend-caller";
import { signalsOf } from "../../backend/context-builder";
import { createEventBus } from "../../core/event-bus";
import { createGuardrails } from "../../core/guardrails";
import { composePacedPipelineBusy } from "../../core/paced-pipeline-busy";
import { createProactivePacer } from "../../core/proactive-pacer";
import { createDispatcher } from "../../dispatcher";
import { makeLogger, NOW, permissiveGuardrailsConfig, SIGNAL_ENVELOPE } from "../../test-helpers";
import { createTurnLog } from "../../turn/turn";
import { createWakeSource } from "../wake/wake-source";
import { createAgentSource } from "./agent-source";
import { createSignalsSource, type SignalsSource } from "./signals-source";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

it.each([
  "agent catch-up",
  "failed wake",
])("restores signals after a %s turn is dropped", async (mode) => {
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
  let acceptAgent: ((event: AgentEvent) => void) | undefined;
  let acceptSignals: ((event: SignalsBatch) => void) | undefined;
  const bus = createEventBus();
  const pacer = createProactivePacer({ getIntervalMs: () => 600_000 });
  const call = vi.fn<BackendCaller["call"]>(
    async (): Promise<TurnOutcome> => (mode === "failed wake" ? "network_drop" : "ok"),
  );
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
    logger: makeLogger(),
    onTurnDropped: (env) => {
      const groups = signalsOf(env);
      if (groups?.length) signalsSource.restore(groups);
    },
  });
  const pipelineBusy = {
    isBusy: dispatcher.isPipelineBusy,
    subscribe: dispatcher.subscribePipelineBusy,
  };
  const paced = composePacedPipelineBusy({ pipelineBusy, pacer });
  const agentSource = createAgentSource({
    bus,
    present_max_idle_ms: 10_000,
    isEnabled: () => true,
    listen,
    onInbox: (cb) => {
      acceptAgent = cb;
      return () => {};
    },
    isPipelineBusy: paced.isBusy,
    subscribePipelineBusy: paced.subscribe,
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
  await agentSource.start();
  await signalsSource.start();
  dispatcher.start();
  tick(20_000);
  const group: SignalGroup = { envelope: SIGNAL_ENVELOPE, items: [{ message: "ready" }] };
  if (mode === "agent catch-up")
    acceptAgent?.({
      tool: "terminal",
      project: "YUI",
      cwd: "/tmp",
      phase: "done",
      summary: "done",
      ts: NOW,
    });
  acceptSignals?.({ signals: group.items, envelope: group.envelope, ts: NOW });
  if (mode === "failed wake") {
    const wake = createWakeSource({
      bus,
      firstActivity: {
        owed: () => ({ name: "first_activity", local_time: "2026-10-24T12:00:00" }),
        latch: () => {},
      },
      drainSignals: signalsSource.drain,
    });
    wake.fire("click");
  } else tick(100);
  await vi.advanceTimersByTimeAsync(50);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]![0].trigger.event_name).toBe(
    mode === "agent catch-up" ? "agent.catchup" : "proactive.wake",
  );
  expect(
    dispatcher.recentDrops().map(({ event_name, reason }) => ({ event_name, reason })),
  ).toEqual([
    {
      event_name: mode === "agent catch-up" ? "signals.catchup" : "proactive.wake",
      reason: mode === "agent catch-up" ? "global_gap" : "network_drop",
    },
  ]);
  expect(signalsSource.drain()).toEqual([group]);
  dispatcher.stop();
  agentSource.stop();
  signalsSource.stop();
  pacer.stop();
});
