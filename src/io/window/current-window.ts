/** Current-window lifetime operations are shared by pet and companion windows. */
import { isTauri } from "../../tauri-env";

export async function closeCurrentWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else window.close();
}

export async function destroyCurrentWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } else window.close();
}

export async function listenCurrentWindowCloseRequested(dispose: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onCloseRequested(async () => {
    dispose();
  });
}
