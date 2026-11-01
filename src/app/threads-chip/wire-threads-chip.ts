/** Main's Threads chip: drawn from the window's Threads and terminal clients, folding with the other chips, opening the Threads window. */

import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { TerminalClient } from "../../io/terminal/terminal-client";
import type { ThreadsClient } from "../../io/threads/threads-client";
import { createThreadsWindowController } from "../../io/window/openers/threads-window";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { createThreadsChip } from "../../ui/threads/chip/threads-chip";

/** Mounts the chip at the end of `mount` from the window's Threads client, and nothing without one; returns its teardown. */
export function wireThreadsChip(deps: {
  client: ThreadsClient | null;
  terminal: Pick<TerminalClient, "snapshot" | "subscribe"> | null;
  /** The tray's Terminal item. */
  onTerminalOpen(cb: () => void): () => void;
  mount: HTMLElement;
  /** The fold store the signal and delegation chips share. */
  collapsed: DelegationChipSettingsStore;
  bridge: Pick<SettingsBridge, "emitThreadsOpen" | "onThreadsReady" | "onThreadsClosed">;
}): () => void {
  // Threads belong to the main character; a window without a client draws no chip.
  if (!deps.client) return () => {};
  const client = deps.client;
  const terminal = deps.terminal;
  // A waiting access request opens the Terminal tab; otherwise the window picks its tab.
  const requestTab = () => (terminal?.snapshot()?.requests.length ? "terminal" : undefined);
  const chip = createThreadsChip({
    mount: deps.mount,
    collapsed: deps.collapsed,
    onOpen: (rect) => {
      if (threadsWindow.open(rect, requestTab())) chip.setExpanded(true);
    },
  });
  const threadsWindow = createThreadsWindowController({
    bridge: deps.bridge,
    onClosed: () => chip.setExpanded(false),
  });
  // subscribe does not replay, so the chip draws the snapshot the client already holds;
  // a null snapshot seeds nothing, leaving the nod baseline to the first real one.
  const seeded = client.snapshot();
  if (seeded) chip.update(seeded.threads);
  const offSnapshot = client.subscribe((snapshot) => chip.update(snapshot.threads));
  const seededTerminal = terminal?.snapshot();
  if (seededTerminal) chip.updateRequests(seededTerminal.requests);
  const offTerminal = terminal?.subscribe((snapshot) => chip.updateRequests(snapshot.requests));
  const offTray = deps.onTerminalOpen(() => {
    if (threadsWindow.open(undefined, "terminal")) chip.setExpanded(true);
  });
  return () => {
    offTray();
    offTerminal?.();
    offSnapshot();
    threadsWindow.dispose();
    chip.dispose();
  };
}
