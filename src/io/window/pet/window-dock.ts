/** The pet window's dock into its own settings window: the shell's link commands and its close event. */

import { createLogger } from "../../../logger";

const log = createLogger("window-dock");

/** Links her window into its settings window; resolves whether a native child link is in effect. */
export async function attachDock(): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("window_dock_attach");
}

/** Unlinks her window from its settings window and gives back her window level. */
export async function detachDock(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("window_dock_detach");
}

/** Moves her window to a physical origin, the settings window's own px when it follows another scale. */
export async function setPetPositionPhysical(x: number, y: number): Promise<void> {
  const [{ getCurrentWindow }, { PhysicalPosition }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/dpi"),
  ]);
  await getCurrentWindow().setPosition(new PhysicalPosition(x, y));
}

/** Calls `cb` when the settings window labelled `label` is asked to close, after the shell unlinked her. */
export function onSettingsStageClosed(label: string, cb: () => void): () => void {
  let off: (() => void) | null = null;
  let disposed = false;
  void import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<string>("yui://settings-stage-closed", (event) => {
        if (event.payload === label) cb();
      }),
    )
    .then((unlisten) => {
      if (disposed) unlisten();
      else off = unlisten;
    })
    .catch((err) => log.warn("settings_stage_closed_listen_failed", { error: String(err) }));
  return () => {
    disposed = true;
    off?.();
  };
}
