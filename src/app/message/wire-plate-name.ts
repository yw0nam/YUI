/** The message plate carries the bound window's preset name, or the active preset's when unbound. */

import { presetNameFor } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { MessagePlate } from "../../ui/message/message-plate";

export function wirePlateName(deps: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  plate: MessagePlate;
  boundId: string | null;
}): () => void {
  const render = (): void => deps.plate.setName(presetNameFor(deps.registry.get(), deps.boundId));
  render();
  return deps.registry.subscribe(render);
}
