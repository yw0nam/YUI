/**
 * TTS 출력 on/off를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface TtsSettings {
  enabled: boolean;
}

export type TtsStorage = PersistedStorage<TtsSettings>;

const DEFAULT_SETTINGS: TtsSettings = {
  enabled: true,
};

function isValidSettings(v: unknown): v is TtsSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createTtsSettings(opts?: { storage?: TtsStorage; initial?: TtsSettings }) {
  const core = createPersistedStore<TtsSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { enabled: v.enabled } : null),
    equals: (a, b) => a.enabled === b.enabled,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage 기반 TtsStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageTtsStorage(key = "yui.tts"): TtsStorage {
  return localStorageStore<TtsSettings>(key);
}
