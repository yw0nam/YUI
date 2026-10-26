/** The name plate carries the bound window's preset face and name, or the active preset's when unbound; a name source names it instead. */

import { presetEntryFor } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { MessagePlate } from "../../ui/message/message-plate";
import type { CharacterName } from "./character-name";

export function wirePlateName(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  plate: MessagePlate;
  boundId: string | null;
  name?: Pick<CharacterName, "get" | "subscribe">;
}): () => void {
  const render = (): void => {
    const entry = presetEntryFor(deps.registry.get(), deps.boundId);
    deps.plate.setName(deps.name?.get() ?? entry.name);
    deps.plate.setFace(entry);
  };
  render();
  // The name source also follows the registry.
  return (deps.name ?? deps.registry).subscribe(render);
}
