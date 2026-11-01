/** threads.html entry: the Threads window. */

import "../styles.css";
import { createDisposers } from "../app/disposers";
import { wireThreadsWindow } from "../app/threads-window/wire-threads-window";
import { createLogger, initLogger } from "../logger";
import { getLocale } from "../ui/i18n";

const log = createLogger("threads-main");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app mount point not found");
  document.documentElement.lang = getLocale();
  await wireThreadsWindow({ app, lifecycle: createDisposers() });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
