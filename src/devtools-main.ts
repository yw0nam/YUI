import "./styles.css";
import "./ui/quick-controls.css";
import "./ui/devtools/devtools.css";
import { wireDevtoolsSync } from "./bootstrap-wiring";
import { createConfigStore } from "./config";
import { createSettingsStores } from "./io/settings-stores";
import { createLogger, initLogger } from "./logger";
import { createDevtoolsShell } from "./ui/devtools/shell";
import { getLocale, subscribe as subscribeLocale, t } from "./ui/i18n";

const log = createLogger("devtools-bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const mount = document.querySelector<HTMLElement>("#app");
  if (!mount) throw new Error("#app mount point not found");

  const settingsStores = createSettingsStores({ locale: getLocale() });
  const { contextHistory, contextSettings, recentAppsSettings, endpointsSettings } = settingsStores;
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
      contextSettings,
      recentAppsSettings,
      endpointsSettings,
      defaultContextWindow,
      loadMotionPreview: async (section) => {
        const { mountMotionPreview } = await import("./ui/devtools/motion-preview");
        return mountMotionPreview(section);
      },
    });
  };
  let shell = buildShell();
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      // The rebuild replaces every node, so a focused edit survives only by id.
      const focused = document.activeElement;
      const editing =
        focused instanceof HTMLInputElement && mount.contains(focused)
          ? { id: focused.id, value: focused.value }
          : null;
      const section = shell.active;
      shell.dispose();
      shell = buildShell();
      shell.activate(section);
      if (!editing) return;
      const restored = document.getElementById(editing.id);
      if (!(restored instanceof HTMLInputElement)) return;
      restored.value = editing.value;
      restored.focus();
      // A scripted value carries no dirty flag, so blur would fire no change and drop the edit.
      restored.dispatchEvent(new Event("change"));
    });
  });
  const { reload, dispose: disposeSync } = wireDevtoolsSync({ stores: settingsStores, log });
  window.addEventListener("focus", reload);
  window.addEventListener("beforeunload", () => {
    // Keeps the bridge alive until disposeSync flushes any pending broadcast.
    shell.dispose();
    disposeSync();
    window.removeEventListener("focus", reload);
    unsubscribeLocale();
    for (const store of Object.values(settingsStores)) store.dispose();
  });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
