/** Synchronizes the preset ids main exposes to the loopback ingress. */

import { isTauri } from "../../../tauri-env";
import { invokeCommand } from "../../tauri-commands/invoke-command";

type PresetInvoke = (command: "sync_preset_ids", args: { ids: string[] }) => Promise<unknown>;

export async function syncPresetIds(
  ids: string[],
  deps?: { invoke?: PresetInvoke },
): Promise<string | null> {
  try {
    if (deps?.invoke) {
      await deps.invoke("sync_preset_ids", { ids });
      return null;
    }
    if (!isTauri()) return null;
    await invokeCommand("sync_preset_ids", { ids });
    return null;
  } catch (error) {
    return String(error);
  }
}
