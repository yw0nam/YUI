/**
 * broker-override-reconciler.test.ts — live broker re-point on endpoint-override change.
 *
 * createBrokerOverrideReconciler wires endpoints overrides → the live Expression Broker client:
 * a broker_base_url override change disposes the old client, creates a new one at the new URL,
 * publishes, then starts. An empty/invalid URL disposes and leaves the broker disabled.
 *
 * Pure seam: every collaborator (broker factory, table loader, payload deriver, current client
 * accessor/setter) is injected — no real network, no real config store.
 */

import { describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import type { BrokerClient, BrokerPayload } from "./broker-client";
import { createBrokerOverrideReconciler } from "./broker-override-reconciler";

function fakeBroker(): BrokerClient & {
  publish: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    getIds: vi.fn(async () => null),
    publish: vi.fn(async () => {}),
    start: vi.fn<() => void>(),
    stop: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
  };
}

function endpoints(over: Partial<EndpointsConfig> = {}): EndpointsConfig {
  return {
    chat_base_url: "http://localhost:8643/v1",
    chat_endpoint: "/v1/responses",
    stt_base_url: "http://localhost:5517",
    tts_base_url: "http://localhost:8092",
    tts_model: "irodori-tts",
    broker_base_url: "http://localhost:3201/mcp",
    ...over,
  };
}

function payloadFor(_eff: EndpointsConfig): BrokerPayload {
  return {
    emotionIds: [],
    motionIds: [],
    emotionText: { mode: "enum", table: { joy: "😊" } },
  };
}

/** Build a reconciler over a mutable "current broker" cell + an effective-endpoints provider. */
function setup(opts: {
  initialBroker: BrokerClient | null;
  eff: () => EndpointsConfig;
  newBroker?: BrokerClient;
}) {
  let current = opts.initialBroker;
  const created: Array<{ baseUrl: string; broker: BrokerClient }> = [];
  const loadTable = vi.fn(async () => ({ joy: "😊" }));
  const createBroker = vi.fn((baseUrl: string) => {
    const b = opts.newBroker ?? fakeBroker();
    created.push({ baseUrl, broker: b });
    return b;
  });
  const reconciler = createBrokerOverrideReconciler({
    getEffectiveEndpoints: opts.eff,
    getBroker: () => current,
    setBroker: (b) => {
      current = b;
    },
    createBroker,
    loadTable,
    derivePayload: (eff) => payloadFor(eff),
  });
  return { reconciler, getCurrent: () => current, created, loadTable, createBroker };
}

describe("createBrokerOverrideReconciler — broker_base_url change", () => {
  it("disposes the old client and creates+publishes+starts a new one at the new URL", async () => {
    const oldBroker = fakeBroker();
    const newBroker = fakeBroker();
    let url = "http://localhost:3201/mcp";
    const { reconciler, getCurrent, created } = setup({
      initialBroker: oldBroker,
      newBroker,
      eff: () => endpoints({ broker_base_url: url }),
    });

    url = "http://other:3201/mcp";
    await reconciler.onChange();

    expect(oldBroker.dispose).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0].baseUrl).toBe("http://other:3201/mcp");
    expect(newBroker.publish).toHaveBeenCalledTimes(1);
    expect(newBroker.start).toHaveBeenCalledTimes(1);
    expect(getCurrent()).toBe(newBroker);
  });

  it("creates a broker when none existed and the URL becomes valid", async () => {
    let url = "";
    const newBroker = fakeBroker();
    const { reconciler, getCurrent } = setup({
      initialBroker: null,
      newBroker,
      eff: () => endpoints({ broker_base_url: url }),
    });
    url = "http://localhost:3201/mcp";
    await reconciler.onChange();
    expect(getCurrent()).toBe(newBroker);
    expect(newBroker.publish).toHaveBeenCalledTimes(1);
    expect(newBroker.start).toHaveBeenCalledTimes(1);
  });

  it("disposes and disables the broker when the URL becomes empty", async () => {
    const oldBroker = fakeBroker();
    let url = "http://localhost:3201/mcp";
    const { reconciler, getCurrent } = setup({
      initialBroker: oldBroker,
      eff: () => endpoints({ broker_base_url: url }),
    });
    url = "";
    await reconciler.onChange();
    expect(oldBroker.dispose).toHaveBeenCalledTimes(1);
    expect(getCurrent()).toBeNull();
  });

  it("does not re-point when the broker_base_url is unchanged", async () => {
    const oldBroker = fakeBroker();
    const { reconciler, created } = setup({
      initialBroker: oldBroker,
      eff: () => endpoints({ broker_base_url: "http://localhost:3201/mcp" }),
    });
    await reconciler.onChange();
    expect(created).toHaveLength(0);
    expect(oldBroker.dispose).not.toHaveBeenCalled();
  });

  it("never throws when a collaborator rejects (best-effort UI path)", async () => {
    const oldBroker = fakeBroker();
    const newBroker = fakeBroker();
    newBroker.publish.mockRejectedValueOnce(new Error("boom"));
    let url = "http://localhost:3201/mcp";
    const { reconciler } = setup({
      initialBroker: oldBroker,
      newBroker,
      eff: () => endpoints({ broker_base_url: url }),
    });
    url = "http://other:3201/mcp";
    await expect(reconciler.onChange()).resolves.toBeUndefined();
  });
});
