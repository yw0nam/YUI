/** An unlisted bound preset closes before application stores are built. */
import type { Logger } from "../../logger";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
export function closeIfOrphan(deps: {
  boundId: string | null;
  registry: Pick<PresetRegistry, "get">;
  close: () => void;
  log: Logger;
}): boolean {
  if (deps.boundId === null || deps.registry.get().list.some((p) => p.id === deps.boundId))
    return false;
  deps.log.info("preset_window_orphan", { preset: deps.boundId });
  deps.close();
  return true;
}
