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

/** Focused element captured before a shell rebuild, keyed by what it takes to restore it. */
type FocusCapture =
  | { kind: "input"; id: string; value: string }
  | { kind: "select"; id: string; value: string }
  | { kind: "nav"; section: string };

/** The rebuild replaces every node, so a focused element survives only by id/section. */
function captureFocus(mount: HTMLElement): FocusCapture | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !mount.contains(focused)) return null;
  if (focused instanceof HTMLInputElement)
    return { kind: "input", id: focused.id, value: focused.value };
  if (focused instanceof HTMLSelectElement)
    return { kind: "select", id: focused.id, value: focused.value };
  if (focused instanceof HTMLButtonElement && focused.dataset.section) {
    return { kind: "nav", section: focused.dataset.section };
  }
  return null;
}

function restoreFocus(mount: HTMLElement, capture: FocusCapture): void {
  switch (capture.kind) {
    case "nav": {
      mount
        .querySelector<HTMLButtonElement>(`[data-section="${CSS.escape(capture.section)}"]`)
        ?.focus();
      return;
    }
    case "input": {
      const restored = document.getElementById(capture.id);
      if (!(restored instanceof HTMLInputElement)) return;
      restored.value = capture.value;
      restored.focus();
      // A scripted value carries no dirty flag, so blur would fire no change and drop the edit.
      restored.dispatchEvent(new Event("change"));
      return;
    }
    case "select": {
      const restored = document.getElementById(capture.id);
      if (!(restored instanceof HTMLSelectElement)) return;
      restored.value = capture.value;
      restored.focus();
      return;
    }
    default: {
      const exhaustive: never = capture;
      throw new Error(`unhandled focus capture kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function bootstrap(): Promise<void> {
  await initLogger();
  const mount = document.querySelector<HTMLElement>("#app");
  if (!mount) throw new Error("#app mount point not found");

  const settingsStores = createSettingsStores({ locale: getLocale() });
  const { contextHistory, endpointsSettings } = settingsStores;
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
        const { mountMotionPreview } = await import("./ui/devtools/motion-preview");
        return mountMotionPreview(section);
      },
    });
  };
  let shell = buildShell();
  let localeRebuild = Promise.resolve();
  const unsubscribeLocale = subscribeLocale(() => {
    localeRebuild = localeRebuild.then(async () => {
      // The rebuild replaces every node, so a focused element survives only by id/section.
      const focus = captureFocus(mount);
      const section = shell.active;
      shell.dispose();
      shell = buildShell();
      // Await so a focused motion-panel select exists before restore looks it up.
      await shell.activate(section);
      if (focus) restoreFocus(mount, focus);
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
