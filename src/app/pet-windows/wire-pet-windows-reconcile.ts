import type { PetWindowOpener } from "../../io/window/openers/pet-window";
import type { Logger } from "../../logger";
import {
  clearPetWindowLive,
  isPetWindowLive,
  LIVE_KEY_PREFIX,
  type PetWindows,
} from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";

export function wirePetWindowsReconcile(deps: {
  petWindows: PetWindows;
  registry: Pick<PresetRegistry, "get">;
  opener: PetWindowOpener;
  log: Logger;
}): () => void {
  let disposed = false,
    running = false,
    requested = false,
    boot = true;
  const waiting = new Map<string, () => void>();
  const request = () => {
    requested = true;
    if (!running && !disposed) void run();
  };
  async function run(): Promise<void> {
    running = true;
    try {
      while (requested && !disposed) {
        requested = false;
        const existing = await deps.opener.existing();
        if (disposed) break;
        if (boot) {
          boot = false;
          deps.petWindows.prune(deps.registry.get().list.map((p) => p.id));
          if (existing !== null) {
            const storage = globalThis.localStorage;
            for (const key of Object.keys(storage ?? {}))
              if (
                key.startsWith(LIVE_KEY_PREFIX) &&
                !existing.includes(key.slice(LIVE_KEY_PREFIX.length))
              )
                clearPetWindowLive(key.slice(LIVE_KEY_PREFIX.length));
            deps.petWindows.invalidate();
          }
        }
        for (const id of deps.petWindows.get()) {
          if (disposed) break;
          try {
            if (existing === null) {
              if (!isPetWindowLive(id)) await deps.opener.open(id);
              continue;
            }
            if (!existing.includes(id)) {
              await deps.opener.open(id);
              continue;
            }
            if (isPetWindowLive(id) || waiting.has(id)) continue;
            const off = await deps.opener.onDestroyed(id, () => {
              waiting.get(id)?.();
              waiting.delete(id);
              request();
            });
            if (disposed) {
              off();
              break;
            }
            waiting.set(id, off);
            const after = await deps.opener.existing();
            if (after !== null && !after.includes(id)) {
              off();
              waiting.delete(id);
              request();
            }
          } catch (error) {
            deps.log.error("pet_window_open_failed", { preset: id, error: String(error) });
          }
        }
      }
    } catch (error) {
      deps.log.error("pet_window_reconcile_failed", { error: String(error) });
    } finally {
      running = false;
    }
  }
  const off = deps.petWindows.subscribe(request);
  request();
  return () => {
    disposed = true;
    off();
    for (const unlisten of waiting.values()) unlisten();
    waiting.clear();
  };
}
