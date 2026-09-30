import { createSettingsStores } from "../../settings/settings-stores";
import { getLocale } from "../../ui/i18n";
import { createConversationStores } from "./conversation-stores";

/** The settings and conversation store bags a window owns, each store's teardown registered. */
export function createWindowStores(register: (dispose: () => void) => void) {
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
  return { settingsStores, conversationStores };
}
