/** Wires the Threads window's Terminal tab: the terminal store's snapshots into its view, its actions to the store, preset names and faces from storage. */

import { createTerminalClient } from "../../io/terminal/terminal-client";
import { readPresetEntry } from "../../settings/preset/active-preset";
import {
  TERMINAL_FONT_PX,
  type ThreadsWindowSettingsStore,
} from "../../settings/threads/threads-window-settings";
import { createTerminalView } from "../../ui/terminal/terminal-view";
import type { TabBody, TabShell } from "../../ui/threads/window/threads-tabs";
import type { Disposers } from "../disposers";

/** The Terminal tab's body for the view to lay out; its client and subscription end with `register`'s bag. */
export function wireTerminalTab(deps: {
  register: Disposers["register"];
  /** Keeps the terminals' font size across restarts. */
  settings: Pick<ThreadsWindowSettingsStore, "get" | "setTerminalFontSize">;
}): (shell: TabShell) => TabBody {
  const client = createTerminalClient();
  deps.register(() => client.dispose());
  return (shell) => {
    const view = createTerminalView({
      shell,
      now: Date.now,
      preset: (id) => readPresetEntry(id) ?? { id, name: id },
      client,
      fontSize: deps.settings.get().terminalFontSize ?? TERMINAL_FONT_PX.default,
      onFontSize: deps.settings.setTerminalFontSize,
    });
    const seeded = client.snapshot();
    if (seeded) view.update(seeded);
    deps.register(client.subscribe(view.update));
    return view;
  };
}
