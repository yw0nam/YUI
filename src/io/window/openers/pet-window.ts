import type { BackgroundThrottlingPolicy } from "@tauri-apps/api/window";
import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";

const log = createLogger("pet-window");
export interface PetWindowOpener {
  open(id: string): Promise<void>;
  existing(): Promise<string[] | null>;
  onDestroyed(id: string, cb: () => void): Promise<() => void>;
}
export async function openPetWindow(env: {
  isTauri: boolean;
  createTauriWindow: () => Promise<void>;
  openBrowserWindow: () => void;
}): Promise<void> {
  if (env.isTauri) await env.createTauriWindow();
  else env.openBrowserWindow();
}
export function createPetWindowOpener(): PetWindowOpener {
  return {
    async open(id) {
      try {
        await openPetWindow({
          isTauri: isTauri(),
          createTauriWindow: async () => {
            const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
            if (await WebviewWindow.getByLabel(`pet-${id}`)) return;
            const win = new WebviewWindow(`pet-${id}`, {
              url: `index.html?preset=${encodeURIComponent(id)}`,
              title: "YUI",
              width: 400,
              height: 600,
              transparent: true,
              decorations: false,
              alwaysOnTop: true,
              resizable: true,
              shadow: false,
              backgroundThrottling: "disabled" as BackgroundThrottlingPolicy,
            });
            await new Promise<void>((resolve, reject) => {
              void win.once("tauri://created", () => resolve());
              void win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
            });
          },
          openBrowserWindow: () => {
            window.open(`/?preset=${encodeURIComponent(id)}`, `yui-pet-${id}`);
          },
        });
        log.info("pet_window_open", { preset: id });
      } catch (error) {
        log.error("pet_window_open_failed", { preset: id, error: String(error) });
        throw error;
      }
    },
    async existing() {
      if (!isTauri()) return null;
      const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
      return (await getAllWebviewWindows())
        .filter((w) => w.label.startsWith("pet-"))
        .map((w) => w.label.slice(4));
    },
    async onDestroyed(id, cb) {
      if (!isTauri()) return () => {};
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = await WebviewWindow.getByLabel(`pet-${id}`);
      return win ? win.once("tauri://destroyed", cb) : () => {};
    },
  };
}
export async function closePetWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else window.close();
}
