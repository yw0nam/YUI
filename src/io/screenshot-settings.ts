/**
 * 스크린샷 기능의 활성화 여부와 소스를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import type { ScreenSource } from "../contract";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ScreenshotSettings {
  enabled: boolean;
  source: ScreenSource;
}

export type ScreenshotStorage = PersistedStorage<ScreenshotSettings>;

const DEFAULT_SETTINGS: ScreenshotSettings = {
  enabled: false,
  source: { kind: "monitor", index: 0 },
};

function isValidSettings(v: unknown): v is ScreenshotSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (s.source === null || typeof s.source !== "object") return false;
  return true;
}

export function createScreenshotSettings(opts?: {
  storage?: ScreenshotStorage;
  initial?: ScreenshotSettings;
}) {
  const core = createPersistedStore<ScreenshotSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? v : null),
    equals: (a, b) =>
      a.enabled === b.enabled && JSON.stringify(a.source) === JSON.stringify(b.source),
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    setSource(source: ScreenSource): void {
      core.commit({ ...core.current(), source });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage 기반 ScreenshotStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageScreenshotStorage(key = "yui.screenshot"): ScreenshotStorage {
  return localStorageStore<ScreenshotSettings>(key);
}
