/**
 * STT(음성입력) on/off 의도를 영속화하는 reactive 설정 스토어.
 * 듣기 상태(voiceInputStatus)와 별개로, 사용자가 음성입력을 켜둔 채 종료했는지를 기억해
 * 다음 실행에서 자동 재개하는 데 쓴다. 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface SttSettings {
  enabled: boolean;
}

export type SttStorage = PersistedStorage<SttSettings>;

const DEFAULT_SETTINGS: SttSettings = {
  enabled: false,
};

function isValidSettings(v: unknown): v is SttSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createSttSettings(opts?: { storage?: SttStorage; initial?: SttSettings }) {
  const core = createPersistedStore<SttSettings>({
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

/** localStorage 기반 SttStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageSttStorage(key = "yui.stt"): SttStorage {
  return localStorageStore<SttSettings>(key);
}
