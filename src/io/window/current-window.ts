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

export async function listenCurrentWindowCloseRequested(
  onRequest: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onCloseRequested(async () => {
    onRequest();
  });
}

export async function focusCurrentWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFocus();
}

/** Calls `onBlur` each time this window loses focus; resolves to the unlisten. */
export async function listenCurrentWindowBlur(onBlur: () => void): Promise<() => void> {
  if (!isTauri()) {
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) onBlur();
  });
}
