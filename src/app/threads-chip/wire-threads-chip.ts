/** Main's Threads chip: drawn from the store's snapshots, folding with the other chips, opening the Threads window. */

import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { createThreadsClient } from "../../io/threads/threads-client";
import { createThreadsWindowController } from "../../io/window/openers/threads-window";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { createThreadsChip } from "../../ui/threads/chip/threads-chip";

/** Mounts the chip at the end of `mount` in main's window, and nothing in a bound pet window; returns its teardown. */
export function wireThreadsChip(deps: {
  boundId: string | null;
  mount: HTMLElement;
  /** The fold store the signal and delegation chips share. */
  collapsed: DelegationChipSettingsStore;
  bridge: Pick<SettingsBridge, "emitThreadsOpen" | "onThreadsReady" | "onThreadsClosed">;
}): () => void {
  // Threads belong to the main character.
  if (deps.boundId !== null) return () => {};
  const client = createThreadsClient();
  const chip = createThreadsChip({
    mount: deps.mount,
    collapsed: deps.collapsed,
    onOpen: (rect) => {
      if (threadsWindow.open(rect)) chip.setExpanded(true);
    },
  });
  const threadsWindow = createThreadsWindowController({
    bridge: deps.bridge,
    onClosed: () => chip.setExpanded(false),
  });
  const offSnapshot = client.subscribe((snapshot) => chip.update(snapshot.threads));
  return () => {
    offSnapshot();
    threadsWindow.dispose();
    chip.dispose();
    client.dispose();
  };
}
