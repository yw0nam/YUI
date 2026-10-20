import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BackgroundThrottlingPolicy } from "@tauri-apps/api/window";
import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";

const log = createLogger("pet-window");
const WINDOW_CREATE_TIMEOUT_MS = 10_000;
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
function waitForCreation(win: Pick<WebviewWindow, "once">): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const unlisteners: Array<() => void> = [];
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const off of unlisteners) off();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => settle(new Error("pet window creation timed out")),
      WINDOW_CREATE_TIMEOUT_MS,
    );
    const listen = (name: "tauri://created" | "tauri://error") => {
      void win
        .once(name, (event) =>
          settle(name === "tauri://error" ? new Error(String(event.payload)) : undefined),
        )
        .then((off) => {
          if (settled) off();
          else unlisteners.push(off);
        })
        .catch(settle);
    };
    listen("tauri://created");
    listen("tauri://error");
  });
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
            // Window options mirror src-tauri/tauri.conf.json app.windows[0].
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
            await waitForCreation(win);
          },
          // The dev build opens a tab; this runs after an await, so a popup blocker may drop it.
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
