/** The stage's foot: the window's own character's name over her transport and window state. */

import { readChatApiOverride } from "../../settings/backend/endpoints-settings";
import { presetEntryFor } from "../../settings/preset/active-preset";
import { isPresetOpen, type PetWindows } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { subscribe as subscribeLocale } from "../i18n";
import { characterMeta } from "../quick-controls/preset/character-meta";
import { useNotify } from "../use-snapshot/use-notify";

type Subscribe = (cb: () => void) => () => void;

/** Storage events and focus: another window may have written her transport. */
const onWindowCue: Subscribe = (cb) => {
  window.addEventListener("storage", cb);
  window.addEventListener("focus", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("focus", cb);
  };
};

export interface StageFootProps {
  presetRegistry: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows: Pick<PetWindows, "get" | "subscribe">;
  /** The bound preset; null in main's settings window. */
  boundId: string | null;
  getDefaultChatApi: () => string | undefined;
  /** Another window's settings change. */
  onSettingsChanged: Subscribe;
}

export function StageFoot(p: StageFootProps) {
  useNotify(p.presetRegistry.subscribe);
  useNotify(p.petWindows.subscribe);
  useNotify(subscribeLocale);
  useNotify(p.onSettingsChanged);
  useNotify(onWindowCue);
  const state = p.presetRegistry.get();
  const entry = presetEntryFor(state, p.boundId);
  const open = p.petWindows.get();
  const { line } = characterMeta({
    id: entry.id,
    main: state.active,
    isOpen: (id) => isPresetOpen(open, id),
    chatApiOverride: readChatApiOverride(entry.id),
    defaultChatApi: p.getDefaultChatApi(),
  });
  return (
    <div className="yui-settings-stage__foot">
      <span className="yui-settings-stage__name">{entry.name}</span>
      <span className="yui-settings-stage__meta">{line}</span>
    </div>
  );
}
