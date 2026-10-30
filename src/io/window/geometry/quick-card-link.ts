/** The quick-card window's native child link to its pet window: true while AppKit moves it with her (macOS only). */

import { invoke } from "@tauri-apps/api/core";

/** Links this window as a child of the window labelled `parentLabel`; false where no such link exists. */
export async function attachQuickCard(parentLabel: string): Promise<boolean> {
  return (await invoke<boolean>("window_dock_attach", { parentLabel })) === true;
}

/** Unlinks this window from its parent; it stays where it is. */
export async function detachQuickCard(): Promise<void> {
  await invoke("window_dock_detach");
}
