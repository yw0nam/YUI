import { isTauri } from "../../../tauri-env";

type PresetInvoke = (command: "sync_preset_ids", args: { ids: string[] }) => Promise<unknown>;

export async function syncPresetIds(
  ids: string[],
  deps?: { invoke?: PresetInvoke },
): Promise<boolean> {
  try {
    if (!deps?.invoke && !isTauri()) return true;
    const invoke = deps?.invoke ?? (await import("@tauri-apps/api/core")).invoke;
    await invoke("sync_preset_ids", { ids });
    return true;
  } catch {
    return false;
  }
}
