/** character-menu.html entry: the Character menu window. */

import "../styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { wireCharacterMenuWindow } from "../app/character-menu/wire-character-menu-window";
import { createDisposers } from "../app/disposers";
import { createSettingsBridge } from "../io/bridge/settings-bridge";
import { listenCurrentWindowBlur } from "../io/window/current-window";
import { tauriFrameWindow } from "../io/window/geometry/tauri-frame-window";
import { createCursorSource } from "../io/window/pet/cursor-source";
import { createHitTestController } from "../io/window/pet/hit-test";
import { createLogger, initLogger } from "../logger";
import { getLocale } from "../ui/i18n";

const log = createLogger("character-menu-main");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app mount point not found");
  document.documentElement.lang = getLocale();
  const win = getCurrentWindow();
  const frame = await tauriFrameWindow();
  if (!frame) throw new Error("the Character menu window runs in Tauri only");
  await wireCharacterMenuWindow({
    app,
    lifecycle: createDisposers(),
    bridge: createSettingsBridge(undefined, { windowKind: "character-menu" }),
    win: {
      setFrame: ({ x, y, width, height }) => frame.setFrameLogical(x, y, width, height),
      show: () => win.show(),
      setFocus: () => win.setFocus(),
      hide: () => win.hide(),
      onBlur: listenCurrentWindowBlur,
      clickThrough: ({ isOverInteractive, getConfig }) =>
        createHitTestController({
          cursor: createCursorSource({ getIntervalMs: () => getConfig().poll_interval_ms }),
          isOverInteractive,
          moveTarget: window,
          getConfig,
        }),
    },
  });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
