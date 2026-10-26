/** The name plate carries the bound window's preset name and face, or the active preset's when unbound. */

import { presetEntryFor } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { MessagePlate } from "../../ui/message/message-plate";

export function wirePlateName(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  plate: MessagePlate;
  boundId: string | null;
}): () => void {
  const render = (): void => {
    const entry = presetEntryFor(deps.registry.get(), deps.boundId);
    deps.plate.setName(entry.name);
    deps.plate.setFace(entry);
  };
  render();
  return deps.registry.subscribe(render);
}
