/** One pet window's active hours: the pacer gap its current span scales, and its do-not-disturb hold. */

import type { PersonaConfig } from "../../config/validators/persona/types";
import type { ActiveHoursSettingsStore } from "../../settings/active-hours/active-hours-settings";
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../../settings/persisted-store";
import type { SettingsStores } from "../../settings/settings-stores";

export interface WindowActiveHours {
  /** The pacer gap now: the gap store × the current span's pace factor (off and normal read × 1). */
  gapMs(): number;
  /** Called whenever gapMs() changes value: a gap edit, a spans or card change, a span boundary crossed. */
  subscribeGap(cb: () => void): () => void;
  /** Do-not-disturb for this pet window: the device switch, or an off span now; subscribe fires only when enabled changes. */
  dnd: Pick<FlagSettingsStore, "get" | "subscribe">;
  /** The bundled persona config, once it has loaded; until then the default card is unknown. */
  setPersona(persona: PersonaConfig): void;
  dispose(): void;
}

export function createWindowActiveHours(_deps: {
  activeHoursSettings: Pick<ActiveHoursSettingsStore, "get" | "subscribe">;
  agentSettings: Pick<SettingsStores["agentSettings"], "get" | "subscribe">;
  pacerGapSettings: Pick<ClampedIntSettingsStore, "get" | "subscribe">;
  dndSettings: Pick<FlagSettingsStore, "get" | "subscribe">;
}): WindowActiveHours {
  return {
    gapMs: () => 0,
    subscribeGap: () => () => {},
    dnd: { get: () => ({ enabled: false }), subscribe: () => () => {} },
    setPersona: () => {},
    dispose: () => {},
  };
}