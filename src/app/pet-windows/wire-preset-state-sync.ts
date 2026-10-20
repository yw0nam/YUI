import { syncPresetIds } from "../../io/bridge/inbox/preset-state";
import type { Logger } from "../../logger";
import type { PresetRegistry } from "../../settings/preset/preset-registry";

export function wirePresetStateSync(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  log: Pick<Logger, "warn">;
  sync?: typeof syncPresetIds;
}): () => void {
  const sync = deps.sync ?? syncPresetIds;
  let disposed = false;
  const publish = () => {
    void sync(deps.registry.get().list.map(({ id }) => id)).then((ok) => {
      if (!ok && !disposed) deps.log.warn("preset_state_sync_failed");
    });
  };
  const off = deps.registry.subscribe(publish);
  publish();
  return () => {
    disposed = true;
    off();
  };
}
