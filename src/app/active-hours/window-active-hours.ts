/** One pet window's active hours: the pacer gap its base and span paces scale, and what holds her own turns. */

import type { PersonaConfig } from "../../config/validators/persona/types";
import type { ActiveHoursSettingsStore } from "../../settings/active-hours/active-hours-settings";
import type { BasePaceSettingsStore } from "../../settings/active-hours/base-pace-settings";
import { spansInUse } from "../../settings/active-hours/card-active-hours";
import { PACE_FACTOR, type Pace, paceAt, type Span } from "../../settings/active-hours/spans";
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../../settings/persisted-store";
import type { RestState } from "../../settings/rest/rest-choices";
import type { RestSettingsStore } from "../../settings/rest/rest-settings";
import { restAt, restDrawnKey, restWakeAt } from "../../settings/rest/rest-state";
import type { SettingsStores } from "../../settings/settings-stores";
import { getLocale } from "../../ui/i18n";

export interface WindowActiveHours {
  /** The pacer gap now: the gap store × the pace factor (base × span; an off span scales nothing). */
  gapMs(): number;
  /** The pace factor now: base × span, the multiplier the idle cues' idle_min reads; an off span scales nothing. */
  paceFactor(): number;
  /** Called whenever gapMs() changes value: a gap edit, a spans or card change, a span boundary crossed. */
  subscribeGap(cb: () => void): () => void;
  /** Do-not-disturb for this pet window: rest() is set, read fresh; subscribe fires only when enabled changes. */
  dnd: Pick<FlagSettingsStore, "get" | "subscribe">;
  /** What holds her own turns at `now`, read fresh: a running Rest or Focus, else an off span, else null. */
  rest(now?: number): RestState | null;
  /** Called when rest()'s kind, choice or end changes, on each Focus minute, and at 00:00 and 08:00. */
  subscribeRest(cb: () => void): () => void;
  /** The bundled persona config, once it has loaded; until then the default card is unknown. */
  setPersona(persona: PersonaConfig): void;
  dispose(): void;
}

const minuteOf = (d: Date): number => d.getHours() * 60 + d.getMinutes();

export function createWindowActiveHours(deps: {
  activeHoursSettings: Pick<ActiveHoursSettingsStore, "get" | "subscribe">;
  basePaceSettings: Pick<BasePaceSettingsStore, "get" | "subscribe">;
  agentSettings: Pick<SettingsStores["agentSettings"], "get" | "subscribe">;
  pacerGapSettings: Pick<ClampedIntSettingsStore, "get" | "subscribe">;
  restSettings: Pick<RestSettingsStore, "get" | "subscribe">;
}): WindowActiveHours {
  let persona: PersonaConfig | undefined;
  const gapListeners = new Set<() => void>();
  const dndListeners = new Set<(s: { enabled: boolean }) => void>();
  const restListeners = new Set<() => void>();

  const spansNow = (): Span[] => {
    const card = deps.agentSettings.get().card ?? persona?.cards[getLocale()];
    return spansInUse(deps.activeHoursSettings.get().spans, card);
  };

  const rest = (now = Date.now()): RestState | null =>
    restAt(deps.restSettings.get(now), spansNow(), now);

  let pace: Pace;
  let factor: number;
  let gap: number;
  let enabled: boolean;
  let shownKey: string;

  const recompute = (): void => {
    const now = Date.now();
    pace = paceAt(spansNow(), minuteOf(new Date(now)));
    const base = deps.basePaceSettings.get().pace;
    factor = (pace === "off" ? 1 : PACE_FACTOR[pace]) * PACE_FACTOR[base];
    const nextGap = deps.pacerGapSettings.get().value * factor;
    if (nextGap !== gap) {
      gap = nextGap;
      for (const cb of gapListeners) cb();
    }
    const state = rest(now);
    const nextEnabled = state !== null;
    if (nextEnabled !== enabled) {
      enabled = nextEnabled;
      for (const cb of dndListeners) cb({ enabled });
    }
    const key = restDrawnKey(state, now);
    if (key !== shownKey) {
      const first = shownKey === undefined;
      shownKey = key;
      if (!first) for (const cb of restListeners) cb();
    }
  };
  recompute();

  // One chain aimed at the next wake; each fire reads the local clock fresh, so DST and sleep need no special case.
  let timer: ReturnType<typeof setTimeout>;
  const arm = (): void => {
    const now = Date.now();
    timer = setTimeout(
      () => {
        recompute();
        arm();
      },
      restWakeAt(deps.restSettings.get(now), now) - now,
    );
  };
  arm();

  const unsubscribes = [
    deps.activeHoursSettings.subscribe(recompute),
    deps.basePaceSettings.subscribe(recompute),
    deps.agentSettings.subscribe(recompute),
    deps.pacerGapSettings.subscribe(recompute),
    deps.restSettings.subscribe(recompute),
  ];

  return {
    gapMs: () => gap,
    paceFactor: () => factor,
    subscribeGap(cb) {
      gapListeners.add(cb);
      return () => gapListeners.delete(cb);
    },
    dnd: {
      get: () => ({ enabled: rest() !== null }),
      subscribe(cb) {
        dndListeners.add(cb);
        return () => dndListeners.delete(cb);
      },
    },
    rest,
    subscribeRest(cb) {
      restListeners.add(cb);
      return () => restListeners.delete(cb);
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
      restListeners.clear();
    },
  };
}
