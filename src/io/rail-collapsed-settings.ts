/**
 * Quick-controls 섹션 rail의 접힘 상태(boolean) reactive 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export type RailCollapsedStorage = PersistedStorage<boolean>;

export function createRailCollapsedSettings(opts?: {
  storage?: RailCollapsedStorage;
  initial?: boolean;
}) {
  const core = createPersistedStore<boolean>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: false,
    parse: (v) => (typeof v === "boolean" ? v : null),
    equals: (a, b) => a === b,
    clone: (v) => v,
    fromInitial: (v) => v,
  });

  return {
    get: core.get,

    setCollapsed(collapsed: boolean): void {
      core.commit(collapsed);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type RailCollapsedSettingsStore = ReturnType<typeof createRailCollapsedSettings>;

/** localStorage 기반 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageRailCollapsedStorage(
  key = "yui.quickControls.railCollapsed",
): RailCollapsedStorage {
  return localStorageStore<boolean>(key);
}
