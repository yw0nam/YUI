/**
 * GitHub PR watcher on/off + poll interval을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface GithubSettings {
  enabled: boolean;
  poll_interval_ms: number;
}

export type GithubStorage = PersistedStorage<GithubSettings>;

const POLL_INTERVAL_FLOOR = 10000;

const DEFAULT_SETTINGS: GithubSettings = {
  enabled: false,
  poll_interval_ms: 60000,
};

function isValidPollInterval(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= POLL_INTERVAL_FLOOR;
}

function isValidSettings(v: unknown): v is GithubSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean" && isValidPollInterval(s.poll_interval_ms);
}

export function createGithubSettings(opts?: { storage?: GithubStorage; initial?: GithubSettings }) {
  const core = createPersistedStore<GithubSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) =>
      isValidSettings(v) ? { enabled: v.enabled, poll_interval_ms: v.poll_interval_ms } : null,
    equals: (a, b) => a.enabled === b.enabled && a.poll_interval_ms === b.poll_interval_ms,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    setPollInterval(ms: number): void {
      if (!isValidPollInterval(ms)) return;
      core.commit({ ...core.current(), poll_interval_ms: ms });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage 기반 GithubStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageGithubStorage(key = "yui.github"): GithubStorage {
  return localStorageStore<GithubSettings>(key);
}
