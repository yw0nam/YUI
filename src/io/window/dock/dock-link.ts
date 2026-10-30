/** The docked window's native child link to its owner window: true while AppKit moves it along (macOS only). */

import { invoke } from "@tauri-apps/api/core";

/** Links this window as a child of the window labelled `parentLabel`; false where no such link exists. */
export async function attachToOwner(parentLabel: string): Promise<boolean> {
  return (await invoke<boolean>("window_dock_attach", { parentLabel })) === true;
}

/** Unlinks this window from its parent; it stays where it is. */
export async function detachFromOwner(): Promise<void> {
  await invoke("window_dock_detach");
}
