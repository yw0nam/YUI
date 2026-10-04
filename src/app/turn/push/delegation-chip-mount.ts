import type { DelegationsStore } from "../../../io/bridge/delegations/delegations-store";
import type { PushSocket } from "../../../io/chat/push/push-socket";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "../../../settings/panels/delegation-chip-settings";
import type { MessageWindowMode } from "../../../settings/panels/message-window-settings";
import { createDelegationChip } from "../../../ui/chips/delegation-chip";

/**
 * The delegation chip's lazy mount — wirePushMode's chip seam. Created only for push mode and
 * disposed when the mode leaves; suppressed while a host port says so (the pet: the popped
 * message window carries the surfaces; the phone: never).
 */
export function createDelegationChipMount(deps: {
  mount: HTMLElement;
  store: Pick<DelegationsStore, "get" | "runningCount" | "subscribe">;
  pushState: Pick<PushSocket, "getState" | "onState">;
  onOpenSettings: () => void;
  suppression?: { get(): boolean; subscribe(cb: () => void): () => void };
}): { create(): void; dispose(): void } {
  let chip: ReturnType<typeof createDelegationChip> | null = null;
  let chipCollapsed: ReturnType<typeof createDelegationChipSettings> | null = null;
  let offSuppression: (() => void) | null = null;
  return {
    // Only push mode carries a delegations list; the chip draws whatever the socket feeds the store.
    create: () => {
      chipCollapsed = createDelegationChipSettings({
        storage: localStorageDelegationChipStorage(),
      });
      chip = createDelegationChip({
        mount: deps.mount,
        store: deps.store,
        collapsed: chipCollapsed,
        pushState: deps.pushState,
        onOpenSettings: deps.onOpenSettings,
        suppressed: deps.suppression?.get(),
      });
      offSuppression =
        deps.suppression?.subscribe(() => chip?.setSuppressed(deps.suppression!.get())) ?? null;
    },
    dispose: () => {
      offSuppression?.();
      offSuppression = null;
      chip?.dispose();
      chipCollapsed?.dispose();
      chip = null;
      chipCollapsed = null;
    },
  };
}

/**
 * The pet's suppression port — the chip is hidden while the popped message window carries the
 * surfaces, shown again while docked. Takes the pet's own reader (wireMessageSurfaces' `getMode`,
 * with its isTauri guard), never the settings store directly.
 */
export function messageWindowSuppression(deps: {
  getMode: () => MessageWindowMode;
  subscribe: (cb: () => void) => () => void;
}): { get(): boolean; subscribe(cb: () => void): () => void } {
  return {
    get: () => deps.getMode() === "popped",
    subscribe: (cb) => deps.subscribe(() => cb()),
  };
}
