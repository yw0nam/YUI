/**
 * Message window (pop-out) bootstrap — message.html entry point.
 *
 * Mounts the pet window's own speech bubble and text input standalone, under a
 * name-plate handle, in a transparent frameless window the user drags anywhere.
 * No renderer and no judgment live here: the pet window sends what to draw over
 * the message bridge, and what the user typed travels back the same way.
 */

import "./styles.css";
import "./ui/message-window.css";
import { loadConfig } from "./config/load";
import type { EndpointsConfig } from "./contract";
import { createMirroredDelegations } from "./io/bridge/delegations-bridge";
import { createMessageBridge } from "./io/bridge/message-bridge";
import { createMirroredPushSocket } from "./io/bridge/push-socket-bridge";
import { createMirroredReasoning } from "./io/bridge/reasoning-bridge";
import { createSettingsBridge } from "./io/bridge/settings-bridge";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "./io/settings/delegation-chip-settings";
import {
  createEndpointsSettings,
  localStorageEndpointsStorage,
  mergeEndpoints,
} from "./io/settings/endpoints-settings";
import {
  createMessageWindowSettings,
  localStorageMessageWindowStorage,
} from "./io/settings/message-window-settings";
import { createFlagSettings, localStorageStore } from "./io/settings/persisted-store";
import { attachKeepOnScreen } from "./io/window/keep-on-screen";
import { MESSAGE_WINDOW_WIDTH } from "./io/window/message-window";
import { toScreenMonitor } from "./io/window/screen-geometry";
import { isTauri } from "./io/window/tauri-env";
import { createLogger, initLogger } from "./logger";
import { createDelegationChip } from "./ui/delegation-chip";
import { reloadFromStorage as reloadLocale } from "./ui/i18n";
import { createMessagePlate } from "./ui/message-plate";
import { createReasoningChip } from "./ui/reasoning-chip";
import { attachSummonKey } from "./ui/summon-key";
import { createSurfaces } from "./ui/surfaces";

const log = createLogger("message-bootstrap");

async function bootstrap(): Promise<void> {
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
  const endpointsSettings = createEndpointsSettings({
    storage: localStorageEndpointsStorage(),
  });

  const bridge = createMessageBridge(undefined, { windowKind: "message" });
  const settingsBridge = createSettingsBridge(undefined, { windowKind: "message" });

  const surfaces = createSurfaces({
    mount: app,
    keepBubbleUntilDismissed: () => bubblePersistSettings.get().enabled,
    onInputOpenChange: (open) => bridge.emitControl({ op: "input-open", open }),
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

  // The socket lives in the pet window; this one mirrors its state and its delegations list.
  const pushSocket = createMirroredPushSocket({ bridge: settingsBridge });
  const delegations = createMirroredDelegations({ bridge: settingsBridge });
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
    suppressed: true,
  });
  const reasoning = createMirroredReasoning({ bridge: settingsBridge });
  const thinkChip = createReasoningChip({
    mount: plateRow,
    store: reasoning,
    suppressed: true,
  });
  // One panel at a time on the shared plate row.
  thinkChip.onPanelOpen(() => chip.closeList());
  chip.onListOpen(() => thinkChip.closePanel());

  // Only push mode has a transport to report on, and the pet window publishes its socket in every
  // mode, so elsewhere that socket sits disconnected and the chip would draw a permanent loss.
  // A state the pet window has not sent yet is not a loss either, so the chip starts away.
  let bundledEndpoints: EndpointsConfig | null = null;
  let sawPushState = false;

  function effectiveChatApi(): string | undefined {
    const overrides = endpointsSettings.get();
    return bundledEndpoints === null
      ? overrides.chat_api
      : mergeEndpoints(bundledEndpoints, overrides).chat_api;
  }

  function applyChipMode(): void {
    const suppressed = !sawPushState || effectiveChatApi() !== "push";
    chip.setSuppressed(suppressed);
    thinkChip.setSuppressed(suppressed);
  }

  applyChipMode();
  const unsubscribeChipState = pushSocket.onState(() => {
    sawPushState = true;
    applyChipMode();
  });
  const unsubscribeEndpoints = endpointsSettings.subscribe(applyChipMode);
  // The bundled default decides the protocol only where no override names one, so the chip waits
  // for it rather than blocking the window's own surfaces on a fetch.
  void loadConfig()
    .then((cfg) => {
      bundledEndpoints = cfg.endpoints;
      applyChipMode();
    })
    .catch((error) => log.warn("config_load_failed", { error: String(error) }));

  bridge.onSurface((op) => {
    switch (op.op) {
      case "begin":
        plate.setLive(true);
        surfaces.beginSpeech();
        break;
      case "push":
        surfaces.pushSpeech(op.delta);
        break;
      case "end":
        plate.setLive(false);
        surfaces.endSpeech(op.defer ? { defer: true } : undefined);
        break;
      case "finish":
        surfaces.finishSpeech();
        break;
      case "hide":
        plate.setLive(false);
        surfaces.hideSpeech();
        break;
      case "summon-input":
        // A document focus in an unfocused webview leaves the keystrokes with the pet window.
        void focusWindow().then(() => surfaces.summonInput());
        break;
      case "dismiss-input":
        surfaces.dismissInput();
        break;
      case "busy":
        plate.setBusy(op.busy);
        surfaces.setBusy(op.busy);
        break;
      case "input-enabled":
        surfaces.setInputEnabled(op.enabled);
        break;
      case "input-error":
        surfaces.showInputError(
          op.message,
          op.action
            ? {
                label: op.action.label,
                onClick: () => bridge.emitControl({ op: "input-error-action" }),
              }
            : undefined,
        );
        break;
      case "attachment-limits":
        surfaces.setAttachmentLimits(op.limits);
        break;
      default: {
        const unhandled: never = op;
        log.warn("unhandled_surface_op", { op: JSON.stringify(unhandled) });
      }
    }
  });

  const detachSummonKey = attachSummonKey(surfaces);

  // The settings window writes the display language into localStorage; both other windows
  // re-read it on the change signal, and again on focus where the signal is unreliable.
  const reloadShared = (): void => {
    reloadLocale();
    bubblePersistSettings.reloadFromStorage();
    endpointsSettings.reloadFromStorage();
    applyChipMode();
    pushSocket.refresh();
    delegations.refresh();
    reasoning.refresh();
  };
  const unlistenSettings = settingsBridge.onSettingsChanged(reloadShared);
  window.addEventListener("focus", reloadShared);

  const disposeWindowWiring = isTauri() ? await wireTauriWindow(surfaces.el) : () => {};

  // A window created after the turn began has no limits and no busy state until it asks.
  // Sent after the window wiring so the surface listener's own registration hop has landed.
  bridge.emitControl({ op: "ready" });

  window.addEventListener("beforeunload", () => {
    disposeWindowWiring();
    detachSummonKey();
    window.removeEventListener("focus", reloadShared);
    unlistenSettings();
    unsubscribeChipState();
    unsubscribeEndpoints();
    chip.dispose();
    chipCollapsed.dispose();
    thinkChip.dispose();
    reasoning.dispose();
    endpointsSettings.dispose();
    pushSocket.dispose();
    delegations.dispose();
    plate.dispose();
    plateRow.remove();
    surfaces.dispose();
    bridge.dispose();
    settingsBridge.dispose();
    messageWindowSettings.dispose();
    bubblePersistSettings.dispose();
  });

  /** Take OS focus so typing lands in this window's field. */
  async function focusWindow(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFocus();
    } catch (error) {
      log.warn("message_window_focus_failed", { error: String(error) });
    }
  }

  /** OS-native window drag from the plate. */
  async function startDragging(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } catch (error) {
      log.warn("message_window_drag_failed", { error: String(error) });
    }
  }

  /** Height tracks the content, and every move records the window's outer position. */
  async function wireTauriWindow(root: HTMLElement): Promise<() => void> {
    const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();

    let lastHeight = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height <= 0 || height === lastHeight) return;
      lastHeight = height;
      void win
        .setSize(new LogicalSize(MESSAGE_WINDOW_WIDTH, height))
        .catch((error) => log.warn("message_window_resize_failed", { error: String(error) }));
    });
    observer.observe(root);

    const unlistenMoved = await win.onMoved(({ payload }) =>
      messageWindowSettings.setPosition(payload.x, payload.y),
    );

    const keepOnScreen = await attachKeepOnScreen(
      {
        outerPosition: () => win.outerPosition(),
        outerSize: () => win.outerSize(),
        setPositionPhysical: (x, y) => win.setPosition(new PhysicalPosition(x, y)),
        onMoved: (cb) => win.onMoved(() => cb()),
        onResized: (cb) => win.onResized(() => cb()),
      },
      async () => (await availableMonitors()).map(toScreenMonitor),
      { wholeWindow: true },
    );

    return () => {
      observer.disconnect();
      unlistenMoved();
      keepOnScreen.dispose();
    };
  }
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
