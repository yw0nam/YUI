/** Synchronizes the preset ids main exposes to the loopback ingress. */
import { isTauri } from "../../../tauri-env";

type PresetInvoke = (command: "sync_preset_ids", args: { ids: string[] }) => Promise<unknown>;

export async function syncPresetIds(
  ids: string[],
  deps?: { invoke?: PresetInvoke },
): Promise<string | null> {
  try {
    if (!deps?.invoke && !isTauri()) return null;
    const invoke = deps?.invoke ?? (await import("@tauri-apps/api/core")).invoke;
    await invoke("sync_preset_ids", { ids });
    return null;
  } catch (error) {
    return String(error);
  }
}
