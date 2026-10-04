import "../styles.css";
import "../ui/quick-controls/quick-controls.css";
import "../ui/devtools/devtools.css";
import { wireDevtoolsSync } from "../app/cross-window/wire-cross-window";
import { createConversationStores } from "../app/settings/conversation-stores";
import { createConfigStore } from "../config/store";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { createSettingsStores } from "../settings/settings-stores";
import { createDevtoolsShell } from "../ui/devtools/shell";
import { createLocaleRebuilder } from "../ui/devtools/shell-rebuild";
import { getLocale, subscribe as subscribeLocale, t } from "../ui/i18n";

const log = createLogger("devtools-bootstrap");

async function bootstrap(): Promise<void> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const mount = document.querySelector<HTMLElement>("#app");
  if (!mount) throw new Error("#app mount point not found");

  const settingsStores = createSettingsStores({ locale: getLocale() });
  const conversationStores = createConversationStores();
  const { contextHistory } = conversationStores;
  const { endpointsSettings } = settingsStores;
  const config = createConfigStore();
  let defaultContextWindow: number | undefined;
  try {
    defaultContextWindow = (await config.load()).endpoints.chat_model_context_window;
  } catch (error) {
    log.warn("config_load_failed", { error: String(error) });
  }

  document.documentElement.lang = getLocale();
  const buildShell = (): ReturnType<typeof createDevtoolsShell> => {
    document.title = t("devtools.label");
    return createDevtoolsShell({
      mount,
      history: contextHistory,
      endpointsSettings,
      defaultContextWindow,
      loadMotionPreview: async (section) => {
        const { mountMotionPreview } = await import("../ui/devtools/motion-preview");
        return mountMotionPreview(section);
      },
    });
  };
  const rebuilder = createLocaleRebuilder({ mount, build: buildShell, log });
  const unsubscribeLocale = subscribeLocale(rebuilder.rebuild);
  const { reload, dispose: disposeSync } = wireDevtoolsSync({
    stores: settingsStores,
    conversation: conversationStores,
    log,
  });
  window.addEventListener("focus", reload);
  window.addEventListener("beforeunload", () => {
    // Keeps the bridge alive until disposeSync flushes any pending broadcast.
    rebuilder.dispose();
    disposeSync();
    window.removeEventListener("focus", reload);
    unsubscribeLocale();
    for (const store of Object.values(settingsStores)) store.dispose();
    for (const store of Object.values(conversationStores)) store.dispose();
  });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
