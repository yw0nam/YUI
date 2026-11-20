/**
 * Screen section — owns the screen-watch threshold knob rows.
 * Same pattern as sibling sections: explicit deps + wired from shell.
 * This module owns inputs, handlers, subscriptions, redraws, teardown.
 */

import type {
  ScreenKnobSettingsStore,
  ScreenOverrides,
} from "../../../../settings/capture/screen-settings";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { reflectUnlessEditing } from "../../../surfaces/reflect-unless-editing";
import { SCREEN_KNOB_FIELDS, type ScreenKnobFieldDef } from "../../constants";

interface ScreenSectionDeps {
  /** Panel root (el) — query the knob inputs here. */
  root: HTMLElement;
  /** Screen-watch on/off flag — its subscription redraws the switch rows. */
  screenSettings?: FlagSettingsStore;
  /** Screen-watch threshold overrides store. Absent when the section isn't rendered. */
  screenKnobSettings?: ScreenKnobSettingsStore;
  /** Bundled config thresholds a knob falls back to when it carries no override (undefined if not loaded). */
  getScreenDefaults?: () => ScreenOverrides | undefined;
  /** Switch-row redraw — the flag subscription calls both. */
  reflectSwitchRows: () => void;
  /** Panel open state — store subscriptions redraw only while the panel is open. */
  isOpen: () => boolean;
}

interface ScreenSection {
  /** Render the knobs from their stores. */
  reflect(): void;
  /** Permanent teardown — unsubscribe stores and remove all listeners. */
  dispose(): void;
}

export function createScreenSection(deps: ScreenSectionDeps): ScreenSection {
  const {
    root: el,
    screenSettings,
    screenKnobSettings,
    getScreenDefaults,
    reflectSwitchRows,
    isOpen,
  } = deps;

  const screenKnobInputs = new Map<ScreenKnobFieldDef["key"], HTMLInputElement>();
  for (const field of SCREEN_KNOB_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) screenKnobInputs.set(field.key, input);
  }

  // Each knob shows its override when set, else the config default.
  function reflectScreen(): void {
    if (!screenKnobSettings) return;
    const overrides = screenKnobSettings.get();
    const defaults = getScreenDefaults?.();
    const effective = (key: keyof ScreenOverrides): number =>
      overrides[key] > 0 ? overrides[key] : (defaults?.[key] ?? 0);
    for (const field of SCREEN_KNOB_FIELDS) {
      const input = screenKnobInputs.get(field.key);
      if (!input) continue;
      const value = effective(field.key);
      reflectUnlessEditing(input, value > 0 ? String(Math.round(value / field.unitMs)) : "");
    }
  }

  const unsubscribeScreen = screenSettings?.subscribe(() => {
    if (isOpen()) {
      reflectSwitchRows();
      reflectScreen();
    }
  });
  const unsubscribeScreenKnobs = screenKnobSettings?.subscribe(() => {
    if (isOpen()) reflectScreen();
  });

  // A knob commits on blur/Enter, never mid-typing.
  // An emptied field clears the override and falls back to configs/screen.json. The row's
  // min/max only bind the spinner, so a typed value is clamped here — the producer must never
  // run outside the range the row advertises.
  function handleScreenKnobChange(e: Event): void {
    const input = e.target;
    if (!screenKnobSettings || !(input instanceof HTMLInputElement)) return;
    const field = SCREEN_KNOB_FIELDS.find((f) => f.id === input.id);
    if (!field) return;
    const typed = Math.round(Number(input.value));
    const units = typed > 0 ? Math.min(Math.max(typed, field.min), field.max) : 0;
    screenKnobSettings.set({ [field.key]: units * field.unitMs });
    reflectScreen();
  }

  for (const input of screenKnobInputs.values()) {
    input.addEventListener("change", handleScreenKnobChange);
    input.addEventListener("blur", reflectScreen);
  }

  return {
    reflect: reflectScreen,
    dispose(): void {
      unsubscribeScreen?.();
      unsubscribeScreenKnobs?.();
      for (const input of screenKnobInputs.values()) {
        input.removeEventListener("change", handleScreenKnobChange);
        input.removeEventListener("blur", reflectScreen);
      }
    },
  };
}
