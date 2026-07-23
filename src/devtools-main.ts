import "./styles.css";
import "./ui/quick-controls.css";
import "./ui/devtools/devtools.css";
import { createConfigStore } from "./config";
import { createContextHistory, localStorageContextHistory } from "./io/context-history";
import { createContextSettings, localStorageContextSettings } from "./io/context-settings";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./io/endpoints-settings";
import { createRecentAppsSettings, localStorageRecentAppsStorage } from "./io/recent-apps-settings";
import { wireStorageSync } from "./io/settings-window";
import { createLogger, initLogger } from "./logger";
import { createDevtoolsShell } from "./ui/devtools/shell";

const log = createLogger("devtools-bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const mount = document.querySelector<HTMLElement>("#app");
  if (!mount) throw new Error("#app mount point not found");

  const history = createContextHistory({ storage: localStorageContextHistory() });
  const contextSettings = createContextSettings({ storage: localStorageContextSettings() });
  const recentAppsSettings = createRecentAppsSettings({
    storage: localStorageRecentAppsStorage(),
  });
  const endpointsSettings = createEndpointsSettings({
    storage: localStorageEndpointsStorage(),
  });
  const config = createConfigStore();
  let defaultContextWindow: number | undefined;
  try {
    defaultContextWindow = (await config.load()).endpoints.chat_model_context_window;
  } catch (error) {
    log.warn("config_load_failed", { error: String(error) });
  }

  const stores = [history, contextSettings, recentAppsSettings, endpointsSettings];
  const shell = createDevtoolsShell({
    mount,
    history,
    contextSettings,
    recentAppsSettings,
    endpointsSettings,
    defaultContextWindow,
    loadMotionPreview: async (section) => {
      const { mountMotionPreview } = await import("./ui/devtools/motion-preview");
      await mountMotionPreview(section);
    },
  });
  const disposeStorageSync = wireStorageSync(stores);
  const reload = (): void => {
    for (const store of stores) store.reloadFromStorage();
  };
  window.addEventListener("focus", reload);
  window.addEventListener("beforeunload", () => {
    disposeStorageSync();
    shell.dispose();
    for (const store of stores) store.dispose();
  });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
