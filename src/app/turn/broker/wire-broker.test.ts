import { beforeEach, describe, expect, it, vi } from "vitest";

// Broker fakes for wireBroker: a single captured client so tests can assert publish/start/dispose.
const { brokerClient, createBrokerClient, deriveExpressVocabulary, createReconciler, selectFetch } =
  vi.hoisted(() => {
    const brokerClient = {
      publish: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
      dispose: vi.fn(),
    };
    return {
      brokerClient,
      createBrokerClient: vi.fn(() => brokerClient),
      deriveExpressVocabulary: vi.fn(() => ({ derived: true })),
      createReconciler: vi.fn(() => ({ onChange: vi.fn().mockResolvedValue(undefined) })),
      selectFetch: vi.fn().mockResolvedValue(undefined),
    };
  });
vi.mock("../../../io/chat/broker/broker-client", () => ({ createBrokerClient }));

vi.mock("../../../io/chat/vocabulary/express-vocabulary", () => ({ deriveExpressVocabulary }));

vi.mock("../../../io/chat/broker/broker-override-reconciler", () => ({
  createBrokerOverrideReconciler: createReconciler,
}));

vi.mock("../../../io/chat/stream/chat-client", () => ({ selectFetch }));

vi.mock("../../../config/emotion-text", () => ({
  loadEmotionTextTable: vi.fn().mockResolvedValue(null),
}));

import { loadEmotionTextTable } from "../../../config/emotion-text";
import { wireBroker } from "./wire-broker";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("wireBroker", () => {
  beforeEach(() => {
    brokerClient.publish.mockClear();
    brokerClient.start.mockClear();
    brokerClient.dispose.mockClear();
    createBrokerClient.mockClear();
    deriveExpressVocabulary.mockClear();
    vi.mocked(loadEmotionTextTable).mockClear();
  });

  // wireBroker fires publish().then(start) fire-and-forget — drain the microtask queue to observe it.
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeDeps = (endpoints: Record<string, unknown>) => {
    const unsub = vi.fn();
    let notifyEndpoints: () => void = () => {};
    const endpointsSettings = {
      subscribe: vi.fn((cb: () => void) => {
        notifyEndpoints = cb;
        return unsub;
      }),
    };
    const onVocabularyChange = vi.fn();
    const unsubExpress = vi.fn();
    // Minimal express-motion store: the wiring only reads it and reacts to its notifications.
    let notify: () => void = () => {};
    const expressMotionSettings = {
      get: () => ({ disabled: [] as string[] }),
      subscribe: vi.fn((cb: () => void) => {
        notify = cb;
        return unsubExpress;
      }),
    };
    return {
      deps: {
        getConfig: () => ({ emotionRegistry: {}, motions: {}, endpoints: {} }) as never,
        getEndpoints: () => endpoints as never,
        endpointsSettings,
        expressMotionSettings,
        onVocabularyChange,
        log: noopLog,
      },
      unsub,
      unsubExpress,
      onVocabularyChange,
      changeExpressMotions: () => notify(),
      changeEndpoints: (next: Record<string, unknown>) => {
        Object.assign(endpoints, next);
        notifyEndpoints();
      },
    };
  };

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

  // The emoji enum table is the only emotion_text vocabulary — nothing gates its load.
  it("always loads the emoji emotion_text table", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    expect(vi.mocked(loadEmotionTextTable)).toHaveBeenCalledWith({ provider: "irodori" });
  });

  it("loads no emoji table for a provider other than irodori — the vocabulary is free", async () => {
    const { deps, onVocabularyChange } = makeDeps({ broker_base_url: "", tts_provider: "openai" });
    const handle = await wireBroker(deps);
    deriveExpressVocabulary.mockClear();

    handle.vocabulary();

    expect(vi.mocked(loadEmotionTextTable)).not.toHaveBeenCalled();
    expect(deriveExpressVocabulary).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.anything(),
    );
    expect(onVocabularyChange).toHaveBeenCalled();
  });

  // The reconciler reloads through this loader on a provider switch, so it reads the live provider.
  it("hands the reconciler a loader that follows the live provider", async () => {
    const endpoints: Record<string, unknown> = { broker_base_url: "", tts_provider: "irodori" };
    const { deps } = makeDeps(endpoints);
    await wireBroker(deps);
    const [reconcilerOpts] = createReconciler.mock.calls.at(-1) as unknown as [
      { loadTable: () => Promise<unknown> },
    ];
    vi.mocked(loadEmotionTextTable).mockClear();

    endpoints.tts_provider = "openai";
    expect(await reconcilerOpts.loadTable()).toBeNull();
    expect(vi.mocked(loadEmotionTextTable)).not.toHaveBeenCalled();

    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "😆": "Laugh" });
    endpoints.tts_provider = "irodori";
    expect(await reconcilerOpts.loadTable()).toEqual({ "😆": "Laugh" });
  });

  it("degrades to a null table when the emotion_text load fails, without throwing into boot", async () => {
    vi.mocked(loadEmotionTextTable).mockRejectedValueOnce(new Error("missing file"));
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    deriveExpressVocabulary.mockClear();

    handle.vocabulary();

    expect(deriveExpressVocabulary).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.anything(),
    );
  });

  it("does nothing when broker_base_url is empty", async () => {
    const { deps } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    expect(createBrokerClient).not.toHaveBeenCalled();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("re-publishes only on config sections that change renderable vocab", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    await flush();
    brokerClient.publish.mockClear();
    const fakeCfg = { emotionRegistry: {}, motions: {}, endpoints: {} } as never;
    handle.onConfigChange(fakeCfg, new Set(["motions"]) as never);
    await flush();
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
    brokerClient.publish.mockClear();
    handle.onConfigChange(fakeCfg, new Set(["guardrails"]) as never);
    await flush();
    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("vocabulary() derives from the live config and the loaded emotion_text table", async () => {
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "🤭": "Giggle" });
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    deriveExpressVocabulary.mockClear();

    handle.vocabulary();

    expect(deriveExpressVocabulary).toHaveBeenCalledWith(
      expect.anything(),
      { "🤭": "Giggle" },
      expect.anything(),
    );
  });

  it("loads the emotion_text table with no broker configured — the vocabulary still feeds the client tools", async () => {
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "🤭": "Giggle" });
    const { deps } = makeDeps({ broker_base_url: "" });
    const handle = await wireBroker(deps);
    deriveExpressVocabulary.mockClear();

    handle.vocabulary();

    expect(vi.mocked(loadEmotionTextTable)).toHaveBeenCalledTimes(1);
    expect(deriveExpressVocabulary).toHaveBeenCalledWith(
      expect.anything(),
      { "🤭": "Giggle" },
      expect.anything(),
    );
  });

  it("tells the vocabulary's other consumers when a config change reloads the table", async () => {
    const { deps, onVocabularyChange } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    await flush();
    onVocabularyChange.mockClear();

    handle.onConfigChange(
      { emotionRegistry: {}, motions: {}, endpoints: {} } as never,
      new Set(["motions"]) as never,
    );
    await flush();

    expect(onVocabularyChange).toHaveBeenCalledTimes(1);
  });

  it("tells them when the expression-motion selection changes", async () => {
    const { deps, onVocabularyChange, changeExpressMotions } = makeDeps({
      broker_base_url: "http://localhost:3201",
    });
    await wireBroker(deps);
    await flush();
    onVocabularyChange.mockClear();

    changeExpressMotions();

    expect(onVocabularyChange).toHaveBeenCalledTimes(1);
  });

  // Retargeting the broker reloads the table through the loader handed to the reconciler, so that
  // loader is the one that must announce. The reconciler itself is mocked here.
  it("tells them when retargeting the broker reloads the table", async () => {
    const { deps, onVocabularyChange } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    await flush();
    onVocabularyChange.mockClear();

    // The last call is this test's — the mock is shared across the block.
    const [reconcilerOpts] = createReconciler.mock.calls.at(-1) as unknown as [
      { loadTable: () => Promise<unknown> },
    ];
    const { loadTable } = reconcilerOpts;
    await loadTable();

    expect(onVocabularyChange).toHaveBeenCalledTimes(1);
  });

  it("drops a table load the provider has moved past, so the vocabulary follows the live provider", async () => {
    const endpoints: Record<string, unknown> = { broker_base_url: "", tts_provider: "irodori" };
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "😆": "Laugh" });
    const { deps } = makeDeps(endpoints);
    const handle = await wireBroker(deps);
    const [reconcilerOpts] = createReconciler.mock.calls.at(-1) as unknown as [
      { loadTable: () => Promise<unknown> },
    ];

    endpoints.tts_provider = "openai";
    await reconcilerOpts.loadTable();
    let release: (table: Record<string, string>) => void = () => {};
    vi.mocked(loadEmotionTextTable).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    endpoints.tts_provider = "irodori";
    const late = reconcilerOpts.loadTable();
    endpoints.tts_provider = "openai";
    await reconcilerOpts.loadTable();
    release({ "😆": "Laugh" });

    expect(await late).toBeNull();
    deriveExpressVocabulary.mockClear();
    handle.vocabulary();
    expect(deriveExpressVocabulary).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.anything(),
    );
  });

  it("reloads the table on a disk endpoints change only when the provider moves", async () => {
    const endpoints: Record<string, unknown> = {
      broker_base_url: "http://localhost:3201",
      tts_provider: "irodori",
    };
    const { deps } = makeDeps(endpoints);
    const handle = await wireBroker(deps);
    await flush();
    vi.mocked(loadEmotionTextTable).mockClear();
    brokerClient.publish.mockClear();
    const cfg = { emotionRegistry: {}, motions: {}, endpoints: {} } as never;

    handle.onConfigChange(cfg, new Set(["endpoints"]) as never);
    await flush();
    expect(vi.mocked(loadEmotionTextTable)).not.toHaveBeenCalled();
    expect(brokerClient.publish).not.toHaveBeenCalled();

    endpoints.tts_provider = "openai";
    handle.onConfigChange(cfg, new Set(["endpoints"]) as never);
    await flush();
    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
  });

  it("tells them even with no broker configured — the vocabulary has other consumers", async () => {
    const { deps, onVocabularyChange } = makeDeps({ broker_base_url: "" });
    const handle = await wireBroker(deps);
    await flush();
    onVocabularyChange.mockClear();

    handle.onConfigChange(
      { emotionRegistry: {}, motions: {}, endpoints: {} } as never,
      new Set(["motions"]) as never,
    );
    await flush();

    expect(onVocabularyChange).toHaveBeenCalledTimes(1);
  });

  it("re-publishes when the expression-motion selection changes", async () => {
    const { deps, changeExpressMotions } = makeDeps({ broker_base_url: "http://localhost:3201" });
    await wireBroker(deps);
    await flush();
    brokerClient.publish.mockClear();

    changeExpressMotions();
    await flush();

    expect(brokerClient.publish).toHaveBeenCalledTimes(1);
  });

  it("skips the selection re-publish when no broker is configured", async () => {
    const { deps, changeExpressMotions } = makeDeps({ broker_base_url: "" });
    await wireBroker(deps);
    await flush();

    changeExpressMotions();
    await flush();

    expect(brokerClient.publish).not.toHaveBeenCalled();
  });

  it("derives the vocabulary against the live expression-motion selection", async () => {
    const { deps } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    deriveExpressVocabulary.mockClear();

    handle.vocabulary();

    expect(deriveExpressVocabulary).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ expressMotions: { disabled: [] } }),
    );
  });

  it("dispose unsubscribes the override listener and disposes the client", async () => {
    const { deps, unsub, unsubExpress } = makeDeps({ broker_base_url: "http://localhost:3201" });
    const handle = await wireBroker(deps);
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(unsubExpress).toHaveBeenCalledTimes(1);
    expect(brokerClient.dispose).toHaveBeenCalledTimes(1);
  });
});
