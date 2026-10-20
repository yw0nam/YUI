import { createPetWindows, type PetWindows } from "../../settings/preset/pet-windows";
import { createPresetRegistry, type PresetRegistry } from "../../settings/preset/preset-registry";
import { createSettingsStores } from "../../settings/settings-stores";
import { getLocale } from "../../ui/i18n";
import { createConversationStores } from "./conversation-stores";

/** The settings and conversation store bags a window owns, each store's teardown registered. */
export function createWindowStores(
  register: (dispose: () => void) => void,
  presets?: { petWindows: PetWindows; presetRegistry: PresetRegistry },
) {
  const petWindows = presets?.petWindows ?? createPetWindows();
  const presetRegistry = presets?.presetRegistry ?? createPresetRegistry();
  if (!presets) {
    register(petWindows.dispose);
    register(presetRegistry.dispose);
  }
  const settingsStores = createSettingsStores({ locale: getLocale() });
  // Every store in a bag shares the same lifecycle, so teardown iterates the bag itself:
  // a store added to either factory is disposed without touching these loops.
  for (const store of Object.values(settingsStores)) {
    register(() => store.dispose());
  }
  const conversationStores = createConversationStores();
  for (const store of Object.values(conversationStores)) {
    register(() => store.dispose());
  }
  return { settingsStores, conversationStores, presetRegistry, petWindows };
}
