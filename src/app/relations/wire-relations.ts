/** Wires this window's relations: rate_relation's targets and the ingress relations RPC. */

import type { onAvatarRpc, respondAvatarRpc } from "../../io/bridge/inbox/avatar-rpc";
import { createRelationsRpc } from "../../io/bridge/inbox/relations-rpc";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { readOpenPresetEntries } from "../../settings/preset/pet-windows";
import type { RelationsStore } from "../../settings/relations/relations-store";

export function wireRelations(deps: {
  relationsStore: RelationsStore;
  /** This window's preset; the targets are the other open presets. */
  presetId: string;
  onAvatarRpc: typeof onAvatarRpc;
  respondAvatarRpc: typeof respondAvatarRpc;
  register: (dispose: () => void) => void;
}): { targets: () => PresetEntry[] } {
  const relationsRpc = createRelationsRpc({
    subscribe: (cb) => deps.onAvatarRpc(cb),
    respond: (id, result) => void deps.respondAvatarRpc(id, result),
    store: deps.relationsStore,
  });
  relationsRpc.start();
  deps.register(relationsRpc.stop);
  return { targets: () => readOpenPresetEntries(deps.presetId) };
}
