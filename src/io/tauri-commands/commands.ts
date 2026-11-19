/** The Tauri commands the client invokes, each with the argument and result type its handler carries. */

import type { WindowRect } from "../../contract";

export interface TauriCommands {
  avatar_rpc_response: { args: { id: string; result: unknown }; result: void };
  drag_window: { args: undefined; result: void };
  remove_user_vrm: { args: { id: string }; result: void };
  sync_preset_ids: { args: { ids: string[] }; result: void };
  threads_order_front: { args: undefined; result: void };
  window_bounds: { args: { windowNumber: number }; result: WindowRect | null };
}

export type CommandName = keyof TauriCommands;

export type CommandArgs<K extends CommandName> = TauriCommands[K]["args"];

/** The argument tuple `invokeCommand` takes: empty when the handler takes no argument. */
export type CommandParams<K extends CommandName> =
  CommandArgs<K> extends undefined ? [] : [args: CommandArgs<K>];
