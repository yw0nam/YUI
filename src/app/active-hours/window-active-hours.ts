/** One pet window's active hours: the pacer gap its current span scales, and its do-not-disturb hold. */

import type { PersonaConfig } from "../../config/validators/persona/types";
import type { ActiveHoursSettingsStore } from "../../settings/active-hours/active-hours-settings";
import { spansInUse } from "../../settings/active-hours/card-active-hours";
import { PACE_FACTOR, type Pace, paceAt } from "../../settings/active-hours/spans";
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../../settings/persisted-store";
import type { SettingsStores } from "../../settings/settings-stores";
import { getLocale } from "../../ui/i18n";

export interface WindowActiveHours {
  /** The pacer gap now: the gap store × the current span's pace factor (off and normal read × 1). */
  gapMs(): number;
  /** The current span's pace factor: the multiplier the idle cues' idle_min reads; off and normal read × 1. */
  paceFactor(): number;
  /** Called whenever gapMs() changes value: a gap edit, a spans or card change, a span boundary crossed. */
  subscribeGap(cb: () => void): () => void;
  /** Do-not-disturb for this pet window: the device switch, or an off span now; subscribe fires only when enabled changes. */
  dnd: Pick<FlagSettingsStore, "get" | "subscribe">;
  /** The bundled persona config, once it has loaded; until then the default card is unknown. */
  setPersona(persona: PersonaConfig): void;
  dispose(): void;
}

export function createWindowActiveHours(deps: {
  activeHoursSettings: Pick<ActiveHoursSettingsStore, "get" | "subscribe">;
  agentSettings: Pick<SettingsStores["agentSettings"], "get" | "subscribe">;
  pacerGapSettings: Pick<ClampedIntSettingsStore, "get" | "subscribe">;
  dndSettings: Pick<FlagSettingsStore, "get" | "subscribe">;
}): WindowActiveHours {
  let persona: PersonaConfig | undefined;
  const gapListeners = new Set<() => void>();
  const dndListeners = new Set<(s: { enabled: boolean }) => void>();

  const paceNow = (): Pace => {
    const card = deps.agentSettings.get().card ?? persona?.cards[getLocale()];
    const spans = spansInUse(deps.activeHoursSettings.get().spans, card);
    const now = new Date();
    return paceAt(spans, now.getHours() * 60 + now.getMinutes());
  };
  const gapNow = (): number => {
    const pace = paceNow();
    return deps.pacerGapSettings.get().value * (pace === "off" ? 1 : PACE_FACTOR[pace]);
  };
  const dndNow = (): boolean => deps.dndSettings.get().enabled || paceNow() === "off";

  let gap = gapNow();
  let enabled = dndNow();

  const recompute = (): void => {
    const nextGap = gapNow();
    if (nextGap !== gap) {
      gap = nextGap;
      for (const cb of gapListeners) cb();
    }
    const nextEnabled = dndNow();
    if (nextEnabled !== enabled) {
      enabled = nextEnabled;
      for (const cb of dndListeners) cb({ enabled });
    }
  };

  // One chain aimed at the next minute boundary; each fire reads the local clock fresh, so DST and sleep need no special case.
  let timer: ReturnType<typeof setTimeout>;
  const arm = (): void => {
    const now = new Date();
    timer = setTimeout(
      () => {
        recompute();
        arm();
      },
      60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()),
    );
  };
  arm();

  const unsubscribes = [
    deps.activeHoursSettings.subscribe(recompute),
    deps.agentSettings.subscribe(recompute),
    deps.pacerGapSettings.subscribe(recompute),
    deps.dndSettings.subscribe(recompute),
  ];

  return {
    gapMs: () => gap,
    paceFactor: () => 0,
    subscribeGap(cb) {
      gapListeners.add(cb);
      return () => gapListeners.delete(cb);
    },
    dnd: {
      get: () => ({ enabled }),
      subscribe(cb) {
        dndListeners.add(cb);
        return () => dndListeners.delete(cb);
      },
    },
    setPersona(next) {
      persona = next;
      recompute();
    },
    dispose() {
      clearTimeout(timer);
      for (const off of unsubscribes) off();
      gapListeners.clear();
      dndListeners.clear();
    },
  };
}
