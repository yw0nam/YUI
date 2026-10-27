/**
 * Unified chat window — unified.html entry point.
 *
 * Shows every open preset's lines, one at a time, in one dialogue box as the pet windows stream
 * them, and routes the user's typed and spoken messages to the pet windows over the bridge. No renderer and no
 * judgment live here: the pet windows' backends answer.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  createThemeSettings,
  localStorageThemeStorage,
} from "../settings/appearance/theme-settings";
import { isTauri } from "../tauri-env";
import { applyTheme } from "../ui/theme/apply-theme";
import "../styles.css";
import "../ui/message/message-window.css";
import "../ui/unified/unified-window.css";
import { createDisposers } from "../app/disposers";
import { wireUnifiedClose } from "../app/unified/wire-unified-close";
import { createSettingsBridge } from "../io/bridge/settings-bridge";
import { readTranscriptAfterBoundary } from "../io/chat/conversation/chat-history-store";
import { closeCurrentWindow, listenCurrentWindowCloseRequested } from "../io/window/current-window";
import {
  focusWindow,
  startDragging,
  wireCompanionColumn,
} from "../io/window/geometry/companion-column";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { readActivePresetId } from "../settings/preset/active-preset";
import { readOpenPresets } from "../settings/preset/pet-windows";
import { createPresetRegistry } from "../settings/preset/preset-registry";
import { createUnifiedChatSwitch } from "../settings/unified/unified-chat-switch";
import { createUnifiedWindowSettings } from "../settings/unified/unified-window-settings";
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
  disposers.register(
    applyTheme({
      store: themeSettings,
      root: document.documentElement,
      setNativeTheme: isTauri() ? (t) => getCurrentWindow().setTheme(t) : undefined,
    }),
  );
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
    focusWindow: () => focusWindow("unified"),
    closeWindow: () => void closeCurrentWindow(),
    startDragging: () => void startDragging("unified"),
  });
  view.onRoute((event) => settingsBridge.emitUserTurnRouted(event));
  view.onStop(settingsBridge.emitStopTurns);
  view.onInputErrorAction((preset) =>
    settingsBridge.emitSpeechStreamControl({ preset, op: { op: "input-error-action" } }),
  );

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
  disposers.register(settingsBridge.onVoiceSegment(({ text }) => view.voiceSegment(text)));
  disposers.register(settingsBridge.onStopTurns(view.stop));
  disposers.register(settingsBridge.onSpeechOnset(view.speechOnset));
  disposers.register(settingsBridge.onSettingsChanged(onSettingsChanged));
  disposers.register(settingsBridge.onPetWindowsChanged(refresh));
  disposers.register(settingsBridge.onPresetChanged(refresh));
  disposers.register(registry.subscribe(view.refresh));
  disposers.register(() => window.removeEventListener("focus", refresh));
  disposers.register(() => window.removeEventListener("storage", refresh));
  window.addEventListener("beforeunload", disposers.dispose);
  view.refresh();
  // A pet window answers with its character's name and turn state; a line already under way shows from its next line.
  settingsBridge.emitSpeechStreamAsk();

  const unifiedChatSwitch = createUnifiedChatSwitch();
  disposers.register(() => unifiedChatSwitch.dispose());
  disposers.register(
    await wireUnifiedClose({
      listenCloseRequested: listenCurrentWindowCloseRequested,
      switch: unifiedChatSwitch,
      emitSettingsChanged: settingsBridge.emitSettingsChanged,
    }),
  );

  if (!isTauri()) return;
  const windowSettings = createUnifiedWindowSettings();
  disposers.register(() => windowSettings.dispose());
  disposers.register(
    await wireCompanionColumn("unified", view.el, windowSettings.setPosition, disposers.isDisposed),
  );
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
