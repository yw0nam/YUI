/**
 * 유휴 절전(30fps 캡) on/off를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface IdleThrottleSettings {
  enabled: boolean;
}

export type IdleThrottleStorage = PersistedStorage<IdleThrottleSettings>;

const DEFAULT_SETTINGS: IdleThrottleSettings = {
  enabled: true,
};

function isValidSettings(v: unknown): v is IdleThrottleSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createIdleThrottleSettings(opts?: {
  storage?: IdleThrottleStorage;
  initial?: IdleThrottleSettings;
}) {
  const core = createPersistedStore<IdleThrottleSettings>({
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

/** localStorage 기반 IdleThrottleStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageIdleThrottleStorage(key = "yui.idle-throttle"): IdleThrottleStorage {
  return localStorageStore<IdleThrottleSettings>(key);
}
