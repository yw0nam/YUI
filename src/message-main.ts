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
import { attachKeepOnScreen } from "./io/keep-on-screen";
import { createMessageBridge } from "./io/message-bridge";
import { MESSAGE_WINDOW_WIDTH } from "./io/message-window";
import {
  createMessageWindowSettings,
  localStorageMessageWindowStorage,
} from "./io/message-window-settings";
import { createFlagSettings, localStorageStore } from "./io/persisted-store";
import { toScreenMonitor } from "./io/screen-geometry";
import { createSettingsBridge } from "./io/settings-bridge";
import { isTauri } from "./io/tauri-env";
import { createLogger, initLogger } from "./logger";
import { reloadFromStorage as reloadLocale } from "./ui/i18n";
import { createMessagePlate } from "./ui/message-plate";
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

  const plate = createMessagePlate({
    mount: surfaces.el,
    onDock: () => bridge.emitControl({ op: "dock" }),
    startDragging: () => void startDragging(),
  });

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
    plate.dispose();
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
