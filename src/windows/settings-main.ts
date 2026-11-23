/**
 * Settings window bootstrap — settings.html entry point.
 *
 * Mounts the settings panel filling the window. No renderer/VRM (settings only).
 * Sync with the main window: receive localStorage writes via the `storage` event and reload the store,
 * plus reload once on focus (Tauri may not emit cross-window storage events).
 */

import "../styles.css";
import "../ui/quick-controls/settings-window.css";
import { createDisposers } from "../app/disposers";
import { bootCompanion } from "../app/pet-windows/companion-window";
import { mountSpikeDockPanel, mountSpikeStage } from "../app/settings-window/spike-stage";
import { wireSettingsWindow } from "../app/settings-window/wire-settings-window";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";

const log = createLogger("settings-bootstrap");

async function bootstrap(): Promise<void> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const lifecycle = createDisposers();
  const companion = await bootCompanion("settings", lifecycle, log);
  if (!companion.alive) return;
  await wireSettingsWindow({ app, lifecycle, presetRegistry: companion.registry });
  // SPIKE #2035: option B stage render.
  await mountSpikeStage(app).catch((error) =>
    log.error("spike_stage_failed", { error: String(error) }),
  );
  // SPIKE #2045: Windows dock probe panel.
  await mountSpikeDockPanel().catch((error) =>
    log.error("spike_dock_panel_failed", { error: String(error) }),
  );
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
