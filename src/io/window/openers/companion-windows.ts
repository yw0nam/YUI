/** Native companion requests and owner observation keep window lifetimes together. */
import { createLogger } from "../../../logger";
import { windowLabel } from "../../../settings/preset/pet-windows";
import { isTauri } from "../../../tauri-env";

const log = createLogger("companion-windows");
export async function closeCompanions(id: string): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await Promise.all(
    (["settings", "message"] as const).map(async (kind) => {
      try {
        await (await WebviewWindow.getByLabel(windowLabel(kind, id)))?.close();
      } catch (error) {
        log.warn("companion_close_failed", { preset: id, kind, error: String(error) });
      }
    }),
  );
}
export async function watchOwner(
  id: string,
  close: () => void | Promise<void>,
): Promise<{ alive: boolean; dispose(): void }> {
  if (!isTauri()) return { alive: true, dispose() {} };
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const owner = await WebviewWindow.getByLabel(windowLabel("pet", id));
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
  if (!(await WebviewWindow.getByLabel(windowLabel("pet", id)))) ownerGone();
  return {
    get alive() {
      return alive;
    },
    dispose: off,
  };
}
