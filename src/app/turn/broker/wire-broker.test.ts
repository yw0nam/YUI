import { beforeEach, describe, expect, it, vi } from "vitest";

// Broker fakes for wireBroker: a single captured client so tests can assert publish/start/dispose.
const { brokerClient, createBrokerClient, createReconciler, selectFetch } = vi.hoisted(() => {
  const brokerClient = {
    publish: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    brokerClient,
    createBrokerClient: vi.fn(() => brokerClient),
    createReconciler: vi.fn(() => ({ onChange: vi.fn().mockResolvedValue(undefined) })),
    selectFetch: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("../../../io/chat/broker/broker-client", () => ({ createBrokerClient }));

vi.mock("../../../io/chat/broker/broker-override-reconciler", () => ({
  createBrokerOverrideReconciler: createReconciler,
}));

vi.mock("../../../io/chat/stream/chat-client", () => ({ selectFetch }));

import { wireBroker } from "./wire-broker";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("wireBroker", () => {
  beforeEach(() => {
    brokerClient.publish.mockClear();
    brokerClient.start.mockClear();
    brokerClient.dispose.mockClear();
    createBrokerClient.mockClear();
  });

  // wireBroker fires publish().then(start) fire-and-forget — drain the microtask queue to observe it.
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeDeps = (endpoints: Record<string, unknown>) => {
    const unsub = vi.fn();
    const unsubVocabulary = vi.fn();
    let moved: () => void = () => {};
    const vocabulary = {
      vocabulary: vi.fn(() => ({
        emotionIds: [],
        motionIds: [],
        emotionText: { mode: "free" as const, table: null },
      })),
      reloadTable: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn((cb: () => void) => {
        moved = cb;
        return unsubVocabulary;
      }),
    };
    return {
      deps: {
        getEndpoints: () => endpoints as never,
        endpointsSettings: { subscribe: vi.fn(() => unsub) },
        vocabulary,
        log: noopLog,
      },
      unsub,
      unsubVocabulary,
      vocabulary,
      moveVocabulary: () => moved(),
    };
  };

  const lastReconcilerOpts = () =>
    createReconciler.mock.calls.at(-1) as unknown as [
      { createBroker: (url: string) => unknown; loadTable: () => unknown },
    ];

  it("publishes then starts when broker_base_url is present", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    expect(createBrokerClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:3201" }),
    );
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
    await flush();
    expect(brokerClient.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when broker_base_url is empty", async () => {
    const { deps } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    expect(createBrokerClient).not.toHaveBeenCalled();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("re-publishes when the vocabulary moves, and skips it when no broker is configured", async () => {
    const withBroker = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(withBroker.deps);
    await flush();
    brokerClient.publish.mockClear();
    withBroker.moveVocabulary();
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);

    brokerClient.publish.mockClear();
    const without = makeDeps({ broker_base_url: "" });
    await wireBroker(without.deps);
    without.moveVocabulary();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("hands the reconciler the vocabulary's table loader", async () => {
    const { deps, vocabulary } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    expect(lastReconcilerOpts()[0].loadTable).toBe(vocabulary.reloadTable);
  });

  it("dispose unsubscribes the override and vocabulary listeners and disposes the client", async () => {
    const { deps, unsub, unsubVocabulary } = makeDeps({
      broker_base_url: "http://localhost:3201",
    });
    const handle = await wireBroker(deps);
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(unsubVocabulary).toHaveBeenCalledTimes(1);
    expect(brokerClient.dispose).toHaveBeenCalledTimes(1);
  });

  describe("deprecation warning", () => {
    const DEPRECATED = {
      what: "broker_base_url",
      removed_in: "v0.6.0",
      use: "client-declared tools",
    };
    const warnings = (log: { warn: ReturnType<typeof vi.fn> }) =>
      log.warn.mock.calls.filter(([event]) => event === "deprecated");

    it("warns once at boot when a broker URL is configured", async () => {
      const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
      const log = { ...(noopLog as object), warn: vi.fn() };
      await wireBroker({ ...deps, log: log as never });
      expect(warnings(log)).toEqual([["deprecated", DEPRECATED]]);
    });

    it("warns once per launch even when a later URL edit creates another client", async () => {
      const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
      const log = { ...(noopLog as object), warn: vi.fn() };
      await wireBroker({ ...deps, log: log as never });
      lastReconcilerOpts()[0].createBroker("http://localhost:3202");
      expect(warnings(log)).toHaveLength(1);
    });

    it("warns when the first URL arrives after boot, and not before", async () => {
      const { deps } = makeDeps({ broker_base_url: "" });
      const log = { ...(noopLog as object), warn: vi.fn() };
      await wireBroker({ ...deps, log: log as never });
      expect(warnings(log)).toHaveLength(0);
      lastReconcilerOpts()[0].createBroker("http://localhost:3201");
      expect(warnings(log)).toEqual([["deprecated", DEPRECATED]]);
    });
  });
});
