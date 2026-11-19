/** The typed entry to the Tauri commands: imports `@tauri-apps/api/core` once, and never outside Tauri. */

import { isTauri } from "../../tauri-env";
import type { CommandArgs, CommandName, CommandParams, TauriCommands } from "./commands";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let core: Promise<InvokeFn> | undefined;

/** Invoke `name` with its typed args; rejects outside the Tauri runtime. */
export async function invokeCommand<K extends CommandName>(
  name: K,
  ...params: CommandParams<K>
): Promise<TauriCommands[K]["result"]> {
  if (!isTauri()) throw new Error("tauri_unavailable");
  core ??= import("@tauri-apps/api/core").then((api) => api.invoke);
  const invoke = await core;
  const args = params[0] as CommandArgs<K> | undefined;
  const out = args === undefined ? await invoke(name) : await invoke(name, args);
  return out as TauriCommands[K]["result"];
}
