/**
 * Settings window (pop-out) bootstrap — settings.html entry point.
 *
 * Mounts the pet window's quick-controls standalone with variant:"window". No renderer/VRM (settings only).
 * Sync with the main window: receive localStorage writes via the `storage` event and reload the store,
 * plus reload once on focus (Tauri may not emit cross-window storage events).
 */

import "../styles.css";
import { createDisposers } from "../app/disposers";
import { bootCompanion } from "../app/pet-windows/companion-window";
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
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
