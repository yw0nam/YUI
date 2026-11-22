/** What the Motion page reads, each repainting at once, and only while the panel is open. */

import { flushSync } from "react-dom";
import type {
  ExpressMotionSettings,
  ExpressMotionSettingsStore,
} from "../../../settings/avatar/express-motion-settings";
import type {
  IdleMotionSettings,
  IdleMotionSettingsStore,
  IdleVariantPool,
} from "../../../settings/avatar/idle-motion-settings";
import type {
  createLipsyncSettings,
  LipsyncSettings,
} from "../../../settings/avatar/lipsync-settings";
import type { SwitchRow } from "../switch-row";

type Subscribe = (cb: () => void) => () => void;
type LipsyncStore = ReturnType<typeof createLipsyncSettings>;

export interface MotionPorts {
  lipsync: {
    current(): Readonly<LipsyncSettings>;
    subscribe: Subscribe;
    setGain(gain: number): void;
  };
  /** Absent where the idle motion section is not rendered. */
  idleMotion?: {
    settings: {
      current(): Readonly<IdleMotionSettings>;
      subscribe: Subscribe;
      setEnabled: IdleMotionSettingsStore["setEnabled"];
    };
    /** The read-only `idle` catalog entry; undefined until configs load. */
    getPool(): IdleVariantPool | undefined;
  };
  /** Absent where the express motion section is not rendered. */
  expressMotion?: {
    settings: {
      current(): Readonly<ExpressMotionSettings>;
      subscribe: Subscribe;
      setEnabled: ExpressMotionSettingsStore["setEnabled"];
      setAllEnabled: ExpressMotionSettingsStore["setAllEnabled"];
    };
    /** Agent-triggerable motion ids from the loaded catalog; empty until configs load. */
    getVocabulary(): readonly string[];
  };
  /** The page's switch rows, in row-table order. */
  rows: readonly SwitchRow[];
}

export function createMotionPorts(deps: {
  lipsync: LipsyncStore;
  idleMotion?: { settings: IdleMotionSettingsStore; getPool: () => IdleVariantPool | undefined };
  expressMotion?: { settings: ExpressMotionSettingsStore; getVocabulary: () => readonly string[] };
  rows: readonly SwitchRow[];
  isOpen: () => boolean;
}): MotionPorts {
  const { lipsync, idleMotion, expressMotion, isOpen } = deps;
  // A change repaints synchronously, so the DOM is current when the event that wrote the store returns.
  const whileOpen =
    (subscribe: Subscribe): Subscribe =>
    (cb) =>
      subscribe(() => {
        if (isOpen()) flushSync(cb);
      });
  return {
    lipsync: { ...lipsync, subscribe: whileOpen(lipsync.subscribe) },
    idleMotion: idleMotion && {
      settings: { ...idleMotion.settings, subscribe: whileOpen(idleMotion.settings.subscribe) },
      getPool: idleMotion.getPool,
    },
    expressMotion: expressMotion && {
      settings: {
        ...expressMotion.settings,
        subscribe: whileOpen(expressMotion.settings.subscribe),
      },
      getVocabulary: expressMotion.getVocabulary,
    },
    rows: deps.rows.map((row) => ({
      ...row,
      subscribe: row.subscribe && whileOpen(row.subscribe),
    })),
  };
}
