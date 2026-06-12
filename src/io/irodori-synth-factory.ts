/**
 * irodori-synth-factory — per-speaker memoized synth + 422 self-heal.
 *
 * The per-sentence synth callback must not rebuild the createIrodoriSynth closure each call,
 * yet must self-heal when the irodori server forgets a voice (422 unknown reference_id).
 * This factory memoizes the closure keyed by the active params and, on a 422, evicts the
 * registration, re-registers once, and retries the synth once.
 */

import type { TtsSynth } from "./irodori-synth";

export interface IrodoriSynthParams {
  baseUrl: string;
  referenceId: string;
  refUrl: string;
  numSteps?: number;
  cfgScaleText?: number;
  cfgScaleSpeaker?: number;
  seconds?: number;
}

export interface IrodoriSynthFactoryDeps {
  /** 현재 활성 화자·튜닝 파라미터를 호출 시점에 읽는다(핫리로드 친화). */
  getParams: () => IrodoriSynthParams;
  ensureRegistered: (args: {
    baseUrl: string;
    id: string;
    refUrl: string;
    fetch: typeof fetch;
  }) => Promise<void>;
  evictRegistration: (baseUrl: string, id: string) => void;
  buildSynth: (params: IrodoriSynthParams, fetchImpl: typeof fetch) => TtsSynth;
  fetch: typeof fetch;
}

function paramsKey(p: IrodoriSynthParams): string {
  return [p.baseUrl, p.referenceId, p.numSteps, p.cfgScaleText, p.cfgScaleSpeaker, p.seconds].join(
    "::",
  );
}

function is422(err: unknown): boolean {
  return typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status === 422
    : /HTTP 422/.test(String((err as { message?: unknown })?.message ?? ""));
}

export function createIrodoriSynthFactory(deps: IrodoriSynthFactoryDeps): TtsSynth {
  let cachedKey: string | undefined;
  let cachedSynth: TtsSynth | undefined;

  const synthFor = (params: IrodoriSynthParams): TtsSynth => {
    const key = paramsKey(params);
    if (key !== cachedKey || !cachedSynth) {
      cachedSynth = deps.buildSynth(params, deps.fetch);
      cachedKey = key;
    }
    return cachedSynth;
  };

  return async (input, signal) => {
    const params = deps.getParams();
    await deps.ensureRegistered({
      baseUrl: params.baseUrl,
      id: params.referenceId,
      refUrl: params.refUrl,
      fetch: deps.fetch,
    });
    const synth = synthFor(params);

    try {
      return await synth(input, signal);
    } catch (err) {
      if (!is422(err)) throw err;
      // 서버가 voice를 잊었다 — 메모 제거 → 단 한 번 재등록 → 단 한 번 재시도.
      deps.evictRegistration(params.baseUrl, params.referenceId);
      await deps.ensureRegistered({
        baseUrl: params.baseUrl,
        id: params.referenceId,
        refUrl: params.refUrl,
        fetch: deps.fetch,
      });
      return await synth(input, signal);
    }
  };
}
