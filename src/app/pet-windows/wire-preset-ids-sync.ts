import { syncPresetIds } from "../../io/bridge/inbox/preset-ids";
import type { Logger } from "../../logger";
import type { PresetRegistry } from "../../settings/preset/preset-registry";

export function wirePresetIdsSync(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  log: Pick<Logger, "warn">;
  sync?: typeof syncPresetIds;
}): () => void {
  const sync = deps.sync ?? syncPresetIds;
  let disposed = false;
  const publish = () => {
    void sync(deps.registry.get().list.map(({ id }) => id)).then((error) => {
      if (error !== null && !disposed) deps.log.warn("preset_ids_sync_failed", { error });
    });
  };
  const off = deps.registry.subscribe(publish);
  publish();
  return () => {
    disposed = true;
    off();
  };
}
