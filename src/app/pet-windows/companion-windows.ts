/** Native companion requests and owner observation keep window lifetimes together. */
import { createLogger, type Logger } from "../../logger";
import { isWindowLive } from "../../settings/preset/pet-windows";
import { isTauri } from "../../tauri-env";

const log = createLogger("companion-windows");
export async function closeCompanions(id: string): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await Promise.all(
    ["settings", "message"].map(async (kind) => {
      try {
        await (await WebviewWindow.getByLabel(`${kind}-${id}`))?.close();
      } catch (error) {
        log.warn("companion_close_failed", { preset: id, kind, error: String(error) });
      }
    }),
  );
}
export async function waitForCompanions(id: string, logger: Logger): Promise<void> {
  for (let elapsed = 0; elapsed < 1000; elapsed += 50) {
    if (!isWindowLive(`settings-${id}`) && !isWindowLive(`message-${id}`)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (isWindowLive(`settings-${id}`) || isWindowLive(`message-${id}`))
    logger.warn("companion_close_timeout", { preset: id });
}
export async function watchOwner(
  id: string,
  close: () => void | Promise<void>,
): Promise<{ alive: boolean; dispose(): void }> {
  if (!isTauri()) return { alive: true, dispose() {} };
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const owner = await WebviewWindow.getByLabel(`pet-${id}`);
  if (!owner) {
    await close();
    return { alive: false, dispose() {} };
  }
  let alive = true;
  const ownerGone = () => {
    alive = false;
    void Promise.resolve(close()).catch((error) =>
      log.warn("companion_close_failed", { preset: id, error: String(error) }),
    );
  };
  const off = await owner.once("tauri://destroyed", ownerGone);
  if (!(await WebviewWindow.getByLabel(`pet-${id}`))) ownerGone();
  return {
    get alive() {
      return alive;
    },
    dispose: off,
  };
}
