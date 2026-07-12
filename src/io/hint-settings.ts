/**
 * First-run onboarding hint의 노출 여부(seen)를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface HintSettings {
  seen: boolean;
}

export type HintStorage = PersistedStorage<HintSettings>;

const DEFAULT_SETTINGS: HintSettings = {
  seen: false,
};

function isValidSettings(v: unknown): v is HintSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.seen === "boolean";
}

export function createHintSettings(opts?: { storage?: HintStorage; initial?: HintSettings }) {
  const core = createPersistedStore<HintSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { seen: v.seen } : null),
    equals: (a, b) => a.seen === b.seen,
  });

  return {
    get: core.get,

    setSeen(seen: boolean): void {
      core.commit({ ...core.current(), seen });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage 기반 HintStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageHintStorage(key = "yui.hint"): HintStorage {
  return localStorageStore<HintSettings>(key);
}
