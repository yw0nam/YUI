/** quick-card.html entry: boots the companion window and wires the quick card into it. */

import "../styles.css";
import { createDisposers } from "../app/disposers";
import { bootCompanion } from "../app/pet-windows/companion-window";
import { wireQuickCardWindow } from "../app/quick-card-window/wire-quick-card-window";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";

const log = createLogger("quick-card-main");

async function bootstrap(): Promise<void> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const lifecycle = createDisposers();
  const companion = await bootCompanion("quick-card", lifecycle, log);
  if (!companion.alive) return;
  await wireQuickCardWindow({ app, lifecycle, presetRegistry: companion.registry });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
