/**
 * broker-override-reconciler.test.ts — live broker re-publish / re-point on
 * endpoint-override change.
 *
 * createBrokerOverrideReconciler wires endpoints overrides → the live Expression Broker client:
 *   - tts_provider override change ⇒ re-publish vocab with the MERGED provider's table.
 *   - broker_base_url override change ⇒ dispose the old client, create a new one at the new
 *     URL, publish, then start. Empty/invalid URL ⇒ dispose + leave broker disabled.
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
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
}

function endpoints(over: Partial<EndpointsConfig> = {}): EndpointsConfig {
  return {
    chat_base_url: "http://localhost:8643/v1",
    chat_endpoint: "/v1/responses",
    stt_base_url: "http://localhost:5517",
    tts_base_url: "http://localhost:8092",
    tts_provider: "irodori",
    irodori_base_url: "http://localhost:8091",
    broker_base_url: "http://localhost:3201/mcp",
    ...over,
  };
}

function payloadFor(eff: EndpointsConfig): BrokerPayload {
  return {
    emotionIds: [],
    motionIds: [],
    emotionText:
      eff.tts_provider === "irodori"
        ? { mode: "enum", table: { joy: "😊" } }
        : { mode: "free", table: null },
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
  const loadTable = vi.fn(async (provider: string | undefined) =>
    provider === "irodori" ? { joy: "😊" } : null,
  );
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

describe("createBrokerOverrideReconciler — tts_provider change", () => {
  it("re-publishes with the merged provider's table when tts_provider changes", async () => {
    const broker = fakeBroker();
    let provider = "irodori";
    const { reconciler, loadTable } = setup({
      initialBroker: broker,
      eff: () => endpoints({ tts_provider: provider as "irodori" | "openai" }),
    });

    provider = "openai";
    await reconciler.onChange();

    expect(loadTable).toHaveBeenCalledWith("openai");
    expect(broker.publish).toHaveBeenCalledTimes(1);
    const sent = broker.publish.mock.calls[0][0] as BrokerPayload;
    expect(sent.emotionText.mode).toBe("free");
  });

  it("does not re-publish when tts_provider is unchanged", async () => {
    const broker = fakeBroker();
    const { reconciler } = setup({
      initialBroker: broker,
      eff: () => endpoints({ tts_provider: "irodori" }),
    });
    await reconciler.onChange();
    expect(broker.publish).not.toHaveBeenCalled();
  });

  it("is a no-op for provider change when no broker is configured", async () => {
    let provider = "irodori";
    const { reconciler, getCurrent } = setup({
      initialBroker: null,
      eff: () => endpoints({ broker_base_url: "", tts_provider: provider as "irodori" | "openai" }),
    });
    provider = "openai";
    await expect(reconciler.onChange()).resolves.toBeUndefined();
    expect(getCurrent()).toBeNull();
  });
});

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
    oldBroker.publish.mockRejectedValueOnce(new Error("boom"));
    let provider = "irodori";
    const { reconciler } = setup({
      initialBroker: oldBroker,
      eff: () => endpoints({ tts_provider: provider as "irodori" | "openai" }),
    });
    provider = "openai";
    await expect(reconciler.onChange()).resolves.toBeUndefined();
  });
});
