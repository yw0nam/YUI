/** Main's Threads chip: drawn from the window's Threads and terminal clients, folding with the other chips, opening the Threads window. */

import type { ScreenRect } from "../../contract";
import type { TerminalClient } from "../../io/terminal/terminal-client";
import type { ThreadsClient } from "../../io/threads/threads-client";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { createThreadsChip } from "../../ui/threads/chip/threads-chip";

/** Mounts the chip at the end of `mount` from the window's Threads client, and nothing without one; returns its teardown and the chip's slot rect (null without a chip). */
export function wireThreadsChip(deps: {
  client: ThreadsClient | null;
  terminal: Pick<TerminalClient, "snapshot" | "subscribe"> | null;
  threadsWindow: Pick<ThreadsWindowController, "open" | "onShown"> | null;
  mount: HTMLElement;
  /** The fold store the signal and delegation chips share. */
  collapsed: DelegationChipSettingsStore;
}): { dispose: () => void; slotRect: (() => ScreenRect) | null } {
  // Threads belong to the main character; a window without a client draws no chip.
  if (!deps.client || !deps.threadsWindow) return { dispose: () => {}, slotRect: null };
  const { client, terminal, threadsWindow } = deps;
  // A waiting access request opens the Terminal tab; otherwise the window picks its tab.
  const requestTab = () => (terminal?.snapshot()?.requests.length ? "terminal" : undefined);
  const chip = createThreadsChip({
    mount: deps.mount,
    collapsed: deps.collapsed,
    onOpen: (rect) => threadsWindow.open(rect, requestTab()),
  });
  const offShown = threadsWindow.onShown(chip.setWindowOpen);
  // subscribe does not replay, so the chip draws the snapshot the client already holds;
  // a null snapshot seeds nothing, leaving the nod baseline to the first real one.
  const seeded = client.snapshot();
  if (seeded) chip.update(seeded.threads);
  const offSnapshot = client.subscribe((snapshot) => chip.update(snapshot.threads));
  const seededTerminal = terminal?.snapshot();
  if (seededTerminal) chip.updateRequests(seededTerminal.requests);
  const offTerminal = terminal?.subscribe((snapshot) => chip.updateRequests(snapshot.requests));
  return {
    dispose() {
      offTerminal?.();
      offSnapshot();
      offShown();
      chip.dispose();
    },
    slotRect: chip.slotRect,
  };
}
