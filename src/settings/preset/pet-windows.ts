/** Desired pet windows and per-window live keys keep preset edits behind running-window guards. */
import { createPersistedStore, localStorageStore, type PersistedStorage } from "../persisted-store";

export const PET_WINDOWS_KEY = "yui.windows";
export const LIVE_KEY_PREFIX = "yui.live-window.";
export type PresetWindowKind = "pet" | "settings" | "message";
export const windowLabel = (kind: PresetWindowKind, id: string): string => `${kind}-${id}`;
export const liveKey = (label: string): string => `${LIVE_KEY_PREFIX}${label}`;
export function isWindowLive(label: string): boolean {
  return globalThis.localStorage?.getItem(liveKey(label)) === "1";
}
export function isPetWindowLive(id: string): boolean {
  return (["pet", "settings", "message"] as const).some((kind) =>
    isWindowLive(windowLabel(kind, id)),
  );
}
export function setWindowLive(label: string): void {
  globalThis.localStorage?.setItem(liveKey(label), "1");
}
export function clearWindowLive(label: string): void {
  globalThis.localStorage?.removeItem(liveKey(label));
}
export function clearStaleLiveKeys(existingLabels: string[]): void {
  const storage = globalThis.localStorage;
  if (!storage) return;
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (
      key?.startsWith(LIVE_KEY_PREFIX) &&
      !existingLabels.includes(key.slice(LIVE_KEY_PREFIX.length))
    )
      storage.removeItem(key);
  }
}
function parse(v: unknown): { open: string[] } | null {
  if (!v || typeof v !== "object" || !Array.isArray((v as { open?: unknown }).open)) return null;
  return {
    open: [
      ...new Set(
        (v as { open: unknown[] }).open.filter(
          (id): id is string => typeof id === "string" && !!id,
        ),
      ),
    ],
  };
}
export function readOpenPetWindowIds(): string[] {
  try {
    return (
      parse(JSON.parse(globalThis.localStorage?.getItem(PET_WINDOWS_KEY) ?? "null"))?.open ?? []
    );
  } catch {
    return [];
  }
}
export function createPetWindows(deps?: { storage?: PersistedStorage<{ open: string[] }> }) {
  const core = createPersistedStore({
    storage: deps?.storage ?? localStorageStore<{ open: string[] }>(PET_WINDOWS_KEY),
    defaults: { open: [] as string[] },
    parse,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => ({ open: [...v.open] }),
  });
  const subscribers = new Set<(ids: string[]) => void>();
  const notify = () => {
    for (const cb of subscribers) cb([...core.get().open]);
  };
  core.subscribe(notify);
  function edit(fn: (ids: string[]) => string[]): void {
    core.reloadFromStorage();
    core.commit({ open: fn(core.get().open) });
  }
  return {
    get: () => core.get().open,
    open: (id: string) => edit((ids) => (id && !ids.includes(id) ? [...ids, id] : ids)),
    close: (id: string) => edit((ids) => ids.filter((v) => v !== id)),
    prune: (listed: string[]) => edit((ids) => ids.filter((id) => listed.includes(id))),
    reloadFromStorage: core.reloadFromStorage,
    invalidate: notify,
    subscribe: (cb: (ids: string[]) => void) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    dispose: () => {
      subscribers.clear();
      core.dispose();
    },
  };
}
export type PetWindows = ReturnType<typeof createPetWindows>;
