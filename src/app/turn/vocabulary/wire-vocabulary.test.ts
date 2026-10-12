import { beforeEach, describe, expect, it, vi } from "vitest";

const { deriveExpressVocabulary } = vi.hoisted(() => ({
  deriveExpressVocabulary: vi.fn(() => ({ derived: true })),
}));
vi.mock("../../../io/chat/vocabulary/express-vocabulary", () => ({ deriveExpressVocabulary }));

vi.mock("../../../config/emotion-text", () => ({
  loadEmotionTextTable: vi.fn().mockResolvedValue(null),
}));

import { loadEmotionTextTable } from "../../../config/emotion-text";
import { wireVocabulary } from "./wire-vocabulary";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const CFG = { emotionRegistry: {}, motions: {}, endpoints: {} } as never;

describe("wireVocabulary", () => {
  beforeEach(() => {
    deriveExpressVocabulary.mockClear();
    vi.mocked(loadEmotionTextTable).mockClear();
  });

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeDeps = (endpoints: Record<string, unknown>) => {
    const unsubExpress = vi.fn();
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
        getConfig: () => CFG,
        getEndpoints: () => endpoints as never,
        expressMotionSettings,
        log: noopLog,
      },
      unsubExpress,
      changeExpressMotions: () => notify(),
    };
  };

  const derivedWith = () => deriveExpressVocabulary.mock.calls.at(-1) as unknown as unknown[];

  it("loads the emoji emotion_text table for irodori, with no broker or other consumer needed", async () => {
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "🤭": "Giggle" });
    const { deps } = makeDeps({ tts_provider: "irodori" });
    const handle = await wireVocabulary(deps);

    handle.vocabulary();

    expect(vi.mocked(loadEmotionTextTable)).toHaveBeenCalledWith({ provider: "irodori" });
    expect(derivedWith()[1]).toEqual({ "🤭": "Giggle" });
  });

  it("loads no emoji table for a provider other than irodori — the vocabulary is free", async () => {
    const { deps } = makeDeps({ tts_provider: "openai" });
    const handle = await wireVocabulary(deps);

    handle.vocabulary();

    expect(vi.mocked(loadEmotionTextTable)).not.toHaveBeenCalled();
    expect(derivedWith()[1]).toBeNull();
  });

  it("degrades to a null table when the load fails, without throwing into boot", async () => {
    vi.mocked(loadEmotionTextTable).mockRejectedValueOnce(new Error("missing file"));
    const { deps } = makeDeps({ tts_provider: "irodori" });
    const handle = await wireVocabulary(deps);

    handle.vocabulary();

    expect(derivedWith()[1]).toBeNull();
  });

  it("derives against the live expression-motion selection", async () => {
    const { deps } = makeDeps({});
    const handle = await wireVocabulary(deps);

    handle.vocabulary();

    expect(derivedWith()[2]).toEqual({ expressMotions: { disabled: [] } });
  });

  it("announces when a config change reloads the table, only for sections that move the vocabulary", async () => {
    const { deps } = makeDeps({ tts_provider: "irodori" });
    const handle = await wireVocabulary(deps);
    const heard = vi.fn();
    handle.subscribe(heard);

    handle.onConfigChange(CFG, new Set(["guardrails"]) as never);
    await flush();
    expect(heard).not.toHaveBeenCalled();

    handle.onConfigChange(CFG, new Set(["motions"]) as never);
    await flush();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("reloads the table on a disk endpoints change only when the provider moves", async () => {
    const endpoints: Record<string, unknown> = { tts_provider: "irodori" };
    const { deps } = makeDeps(endpoints);
    const handle = await wireVocabulary(deps);
    const heard = vi.fn();
    handle.subscribe(heard);

    handle.onConfigChange(CFG, new Set(["endpoints"]) as never);
    await flush();
    expect(heard).not.toHaveBeenCalled();

    endpoints.tts_provider = "openai";
    handle.onConfigChange(CFG, new Set(["endpoints"]) as never);
    await flush();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("announces when the expression-motion selection changes", async () => {
    const { deps, changeExpressMotions } = makeDeps({});
    const handle = await wireVocabulary(deps);
    const heard = vi.fn();
    handle.subscribe(heard);

    changeExpressMotions();

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("drops a table load the provider has moved past, so the vocabulary follows the live provider", async () => {
    const endpoints: Record<string, unknown> = { tts_provider: "irodori" };
    vi.mocked(loadEmotionTextTable).mockResolvedValueOnce({ "😆": "Laugh" });
    const { deps } = makeDeps(endpoints);
    const handle = await wireVocabulary(deps);

    endpoints.tts_provider = "openai";
    await handle.reloadTable();
    let release: (table: Record<string, string>) => void = () => {};
    vi.mocked(loadEmotionTextTable).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    endpoints.tts_provider = "irodori";
    const late = handle.reloadTable();
    endpoints.tts_provider = "openai";
    await handle.reloadTable();
    release({ "😆": "Laugh" });

    expect(await late).toBeNull();
    handle.vocabulary();
    expect(derivedWith()[1]).toBeNull();
  });

  it("dispose unsubscribes the selection listener", async () => {
    const { deps, unsubExpress } = makeDeps({});
    const handle = await wireVocabulary(deps);
    handle.dispose();
    expect(unsubExpress).toHaveBeenCalledTimes(1);
  });
});
