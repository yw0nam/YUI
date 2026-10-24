import type { SignalGroup } from "../../contract";
import type { SignalRecord } from "../../io/chat/conversation/signal-history-store";
import {
  createDelegationChipSettings,
  type DelegationChipSettingsStore,
  localStorageDelegationChipStorage,
} from "../../settings/panels/delegation-chip-settings";
import { createSignalChips } from "../../ui/chips/signal-chips";
import { createSignalChipsModel } from "../../ui/chips/signal-chips-model";

/**
 * The signal chips beside the avatar — on every transport. Owns the fold store the delegation
 * chip shares, so a held press on either kind folds both.
 */
export function wireSignalChips(deps: {
  mount: HTMLElement;
  signalHistory: { records(): SignalRecord[]; subscribe(cb: () => void): () => void };
  register: (dispose: () => void) => void;
}): { onArrival: (group: SignalGroup) => void; collapsed: DelegationChipSettingsStore } {
  const collapsed = createDelegationChipSettings({ storage: localStorageDelegationChipStorage() });
  const model = createSignalChipsModel({ history: deps.signalHistory });
  const chips = createSignalChips({ mount: deps.mount, model, collapsed });
  // Disposed in reverse: the chips unsubscribe before the stores they read go.
  deps.register(collapsed.dispose);
  deps.register(model.dispose);
  deps.register(chips.dispose);
  return { onArrival: model.add, collapsed };
}
