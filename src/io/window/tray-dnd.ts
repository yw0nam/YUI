/** The tray's Do Not Disturb check, set from the do-not-disturb store. */

import { invoke } from "@tauri-apps/api/core";

export function setTrayDnd(on: boolean): Promise<void> {
  return invoke<void>("set_tray_dnd", { on });
}
