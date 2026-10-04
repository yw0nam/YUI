/**
 * Message window (pop-out) bootstrap — message.html entry point.
 *
 * Mounts the pet window's own speech bubble and text input standalone, under a
 * name-plate handle, in a transparent frameless window the user drags anywhere.
 * No renderer and no judgment live here: the pet window sends what to draw over
 * the message bridge, and what the user typed travels back the same way.
 */

import "../styles.css";
import "../ui/message/message-window.css";
import { createDisposers } from "../app/disposers";
import { wireMessageSurfaceOps } from "../app/message/wire-message-surface-ops";
import { startDragging, wireTauriWindow } from "../app/message/wire-message-tauri-window";
import { createMirroredDelegations } from "../io/bridge/delegations-bridge";
import { createMessageBridge } from "../io/bridge/message-bridge";
import { createMirroredPushSocket } from "../io/bridge/push-socket-bridge";
import { createMirroredReasoning } from "../io/bridge/reasoning-bridge";
import { createSettingsBridge } from "../io/bridge/settings-bridge";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "../settings/panels/delegation-chip-settings";
import {
  createMessageWindowSettings,
  localStorageMessageWindowStorage,
} from "../settings/panels/message-window-settings";
import { createFlagSettings, localStorageStore } from "../settings/persisted-store";
import { isTauri } from "../tauri-env";
import { createDelegationChip } from "../ui/chips/delegation-chip";
import { reloadFromStorage as reloadLocale } from "../ui/i18n";
import { createMessagePlate } from "../ui/message/message-plate";
import { attachSummonKey } from "../ui/surfaces/summon-key";
import { createSurfaces } from "../ui/surfaces/surfaces";

const log = createLogger("message-bootstrap");

async function bootstrap(): Promise<void> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const messageWindowSettings = createMessageWindowSettings({
    storage: localStorageMessageWindowStorage(),
  });
  const bubblePersistSettings = createFlagSettings(false, {
    storage: localStorageStore("yui.bubble-persist"),
  });

  const bridge = createMessageBridge(undefined, { windowKind: "message" });
  const settingsBridge = createSettingsBridge(undefined, { windowKind: "message" });

  // The socket lives in the pet window; this one mirrors its state, its delegations list and its reasoning.
  const pushSocket = createMirroredPushSocket({ bridge: settingsBridge });
  const delegations = createMirroredDelegations({ bridge: settingsBridge });
  const reasoning = createMirroredReasoning({ bridge: settingsBridge });

  const surfaces = createSurfaces({
    mount: app,
    // Tool tells stay with the character; this window draws none.
    tool: { showTool() {}, finishTool() {}, hideTool() {} },
    keepBubbleUntilDismissed: () => bubblePersistSettings.get().enabled,
    onInputOpenChange: (open) => bridge.emitControl({ op: "input-open", open }),
    reasoning,
  });
  surfaces.el.classList.add("yui-ui--message");
  surfaces.onSubmit((text, images) => bridge.emitControl({ op: "submit", text, images }));
  surfaces.onStop(() => bridge.emitControl({ op: "stop" }));

  // The plate and the chip share the column's first row; the chip sits to the plate's right.
  const plateRow = document.createElement("div");
  plateRow.className = "yui-plate-row";
  surfaces.el.prepend(plateRow);
  const plate = createMessagePlate({
    mount: plateRow,
    onDock: () => bridge.emitControl({ op: "dock" }),
    startDragging: () => void startDragging(),
  });

  const chipCollapsed = createDelegationChipSettings({
    storage: localStorageDelegationChipStorage(),
  });
  const chip = createDelegationChip({
    mount: plateRow,
    store: delegations,
    collapsed: chipCollapsed,
    pushState: pushSocket,
    // The character window owns the settings panel, and opens it on the tab the chat section is on.
    onOpenSettings: () => bridge.emitControl({ op: "open-settings" }),
  });

  wireMessageSurfaceOps({ bridge, surfaces, plate });

  const detachSummonKey = attachSummonKey(surfaces);

  // The settings window writes the display language into localStorage; both other windows
  // re-read it on the change signal, and again on focus where the signal is unreliable.
  const reloadShared = (): void => {
    reloadLocale();
    bubblePersistSettings.reloadFromStorage();
    pushSocket.refresh();
    delegations.refresh();
    reasoning.refresh();
  };
  const unlistenSettings = settingsBridge.onSettingsChanged(reloadShared);
  window.addEventListener("focus", reloadShared);

  const disposeWindowWiring = isTauri()
    ? await wireTauriWindow(surfaces.el, messageWindowSettings)
    : () => {};

  // A window created after the turn began has no limits and no busy state until it asks.
  // Sent after the window wiring so the surface listener's own registration hop has landed.
  bridge.emitControl({ op: "ready" });

  // The bag drains LIFO, so these register in the reverse of the order they run.
  const disposers = createDisposers();
  disposers.register(() => bubblePersistSettings.dispose());
  disposers.register(() => messageWindowSettings.dispose());
  disposers.register(() => settingsBridge.dispose());
  disposers.register(() => bridge.dispose());
  disposers.register(() => reasoning.dispose());
  disposers.register(() => surfaces.dispose());
  disposers.register(() => plateRow.remove());
  disposers.register(() => plate.dispose());
  disposers.register(() => delegations.dispose());
  disposers.register(() => pushSocket.dispose());
  disposers.register(() => chipCollapsed.dispose());
  disposers.register(() => chip.dispose());
  disposers.register(unlistenSettings);
  disposers.register(() => window.removeEventListener("focus", reloadShared));
  disposers.register(detachSummonKey);
  disposers.register(disposeWindowWiring);
  window.addEventListener("beforeunload", disposers.dispose);
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
