/**
 * The settings window's stage: a column on the window's left, beside the panel. Its foot names the
 * window's own character (the bound one, else main), not the one the panel edits.
 */

import "./settings-stage.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { readChatApiOverride } from "../../settings/backend/endpoints-settings";
import { presetEntryFor } from "../../settings/preset/active-preset";
import { isPresetWindowLive } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { subscribe as subscribeLocale } from "../i18n";
import { characterMeta } from "../quick-controls/preset/character-meta";
import { StageFoot } from "./stage-foot";

export function createSettingsStage(deps: {
  mount: HTMLElement;
  presetRegistry: Pick<PresetRegistry, "get" | "subscribe">;
  boundId: string | null;
  getDefaultChatApi: () => string | undefined;
  /** Another window's settings change. */
  onSettingsChanged: (cb: () => void) => () => void;
}): { dispose(): void } {
  const el = document.createElement("div");
  el.className = "yui-settings-stage";
  deps.mount.appendChild(el);
  const root = createRoot(el);

  // Storage holds her transport, so every cue that another window wrote re-reads it.
  const render = (): void => {
    const state = deps.presetRegistry.get();
    const entry = presetEntryFor(state, deps.boundId);
    const { line } = characterMeta({
      id: entry.id,
      main: state.active,
      // A bound character's own settings window, this one, is live while it shows.
      isOpen: isPresetWindowLive,
      chatApiOverride: readChatApiOverride(entry.id),
      defaultChatApi: deps.getDefaultChatApi(),
    });
    root.render(createElement(StageFoot, { name: entry.name, line }));
  };
  render();
  const offs = [
    deps.presetRegistry.subscribe(render),
    subscribeLocale(render),
    deps.onSettingsChanged(render),
  ];
  window.addEventListener("storage", render);
  window.addEventListener("focus", render);

  return {
    dispose() {
      for (const off of offs) off();
      window.removeEventListener("storage", render);
      window.removeEventListener("focus", render);
      root.unmount();
      el.remove();
    },
  };
}
