/** The name plate carries the character's name and the bound window's preset face, or the active preset's when unbound. */

import { presetEntryFor } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { MessagePlate } from "../../ui/message/message-plate";

export function wirePlateName(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  plate: MessagePlate;
  boundId: string | null;
  name: { get(): string; subscribe(cb: () => void): () => void };
}): () => void {
  const render = (): void => {
    deps.plate.setName(deps.name.get());
    deps.plate.setFace(presetEntryFor(deps.registry.get(), deps.boundId));
  };
  render();
  const offRegistry = deps.registry.subscribe(render);
  const offName = deps.name.subscribe(render);
  return () => {
    offRegistry();
    offName();
  };
}
