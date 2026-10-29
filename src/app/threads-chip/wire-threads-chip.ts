/** Main's Threads chip: drawn from the window's Threads client, folding with the other chips, opening the Threads window. */

import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { ThreadsClient } from "../../io/threads/threads-client";
import { createThreadsWindowController } from "../../io/window/openers/threads-window";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { createThreadsChip } from "../../ui/threads/chip/threads-chip";

/** Mounts the chip at the end of `mount` from the window's Threads client, and nothing without one; returns its teardown. */
export function wireThreadsChip(deps: {
  client: ThreadsClient | null;
  mount: HTMLElement;
  /** The fold store the signal and delegation chips share. */
  collapsed: DelegationChipSettingsStore;
  bridge: Pick<SettingsBridge, "emitThreadsOpen" | "onThreadsReady" | "onThreadsClosed">;
}): () => void {
  // Threads belong to the main character; a window without a client draws no chip.
  if (!deps.client) return () => {};
  const client = deps.client;
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
  // subscribe does not replay, so the chip draws the snapshot the client already holds.
  chip.update(client.snapshot()?.threads ?? []);
  const offSnapshot = client.subscribe((snapshot) => chip.update(snapshot.threads));
  return () => {
    offSnapshot();
    threadsWindow.dispose();
    chip.dispose();
  };
}
