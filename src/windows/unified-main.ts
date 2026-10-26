/**
 * Unified chat window — unified.html entry point.
 *
 * Draws every open preset's current-session transcript in one list and routes the user's
 * messages to the pet windows over the bridge. No renderer and no judgment live here: the pet
 * windows' backends answer, and their transcripts are what this window reads.
 */

import {
  createThemeSettings,
  localStorageThemeStorage,
} from "../settings/appearance/theme-settings";
import { applyTheme } from "../ui/theme/apply-theme";
import "../styles.css";
import "../ui/unified/unified-window.css";
import { createDisposers } from "../app/disposers";
import { createSettingsBridge } from "../io/bridge/settings-bridge";
import { readTranscriptAfterBoundary } from "../io/chat/conversation/chat-history-store";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { readActivePresetId } from "../settings/preset/active-preset";
import { readOpenPresets } from "../settings/preset/pet-windows";
import { createPresetRegistry } from "../settings/preset/preset-registry";
import { reloadFromStorage as reloadLocale } from "../ui/i18n";
import { createUnifiedView } from "../ui/unified/unified-view";

const log = createLogger("unified-main");

async function bootstrap(): Promise<void> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app mount point not found");

  const disposers = createDisposers();
  const themeSettings = createThemeSettings({ storage: localStorageThemeStorage() });
  disposers.register(() => themeSettings.dispose());
  disposers.register(applyTheme({ store: themeSettings, root: document.documentElement }));
  const settingsBridge = createSettingsBridge(undefined, { windowKind: "unified" });
  const registry = createPresetRegistry();

  const view = createUnifiedView({
    mount: app,
    cast: readOpenPresets,
    transcripts: () =>
      readOpenPresets().map((c) => ({ ...c, entries: readTranscriptAfterBoundary(c.id) })),
    mainId: readActivePresetId,
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  });
  view.onRoute((event) => settingsBridge.emitUserTurnRouted(event));

  // A photo picked in another window reaches the registry through storage, so it reloads first.
  const refresh = (): void => {
    themeSettings.reloadFromStorage();
    registry.reloadFromStorage();
    view.refresh();
  };
  const onSettingsChanged = (): void => {
    reloadLocale();
    refresh();
  };
  window.addEventListener("focus", refresh);
  window.addEventListener("storage", refresh);

  // The bag drains LIFO, so these register in the reverse of the order they run.
  disposers.register(() => registry.dispose());
  disposers.register(() => settingsBridge.dispose());
  disposers.register(() => view.dispose());
  disposers.register(settingsBridge.onSpeechStream(view.speechStream));
  disposers.register(settingsBridge.onUserTurnDone(view.turnDone));
  disposers.register(settingsBridge.onSettingsChanged(onSettingsChanged));
  disposers.register(settingsBridge.onPetWindowsChanged(refresh));
  disposers.register(settingsBridge.onPresetChanged(refresh));
  disposers.register(registry.subscribe(view.refresh));
  disposers.register(() => window.removeEventListener("focus", refresh));
  disposers.register(() => window.removeEventListener("storage", refresh));
  window.addEventListener("beforeunload", disposers.dispose);
  view.refresh();
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
