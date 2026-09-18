/**
 * Screen section — owns the screen-watch threshold knob rows and the min-gap slider.
 * Same pattern as sibling sections: explicit deps + wired from shell. reflect (store→DOM) handled by reflect layer;
 * this module owns inputs, handlers, subscriptions, teardown only.
 */
import type { FlagSettingsStore } from "../../io/settings/persisted-store";
import type { ScreenKnobSettingsStore } from "../../io/settings/screen-settings";
import { t } from "../i18n";
import {
  SCREEN_KNOB_FIELDS,
  SCREEN_MIN_GAP_MAX,
  SCREEN_MIN_GAP_MIN,
  type ScreenKnobFieldDef,
} from "./constants";

interface ScreenSectionDeps {
  /** Panel root (el) — query the knob inputs and the gap slider here. */
  root: HTMLElement;
  /** Screen-watch on/off flag — its subscription redraws both switch rows and the knob group. */
  screenSettings?: FlagSettingsStore;
  /** Screen-watch threshold overrides store. Absent when the section isn't rendered. */
  screenKnobSettings?: ScreenKnobSettingsStore;
  /** Reflect layer's knob-group redraw (reflectScreen). */
  reflectScreen: () => void;
  /** Reflect layer's switch-row redraw — the flag subscription calls both. */
  reflectSwitchRows: () => void;
  /** Popover open state — store subscriptions redraw only while the panel is open. */
  isOpen: () => boolean;
}

interface ScreenSection {
  /** Permanent teardown — unsubscribe stores and remove all listeners. */
  dispose(): void;
}

export function createScreenSection(deps: ScreenSectionDeps): ScreenSection {
  const {
    root: el,
    screenSettings,
    screenKnobSettings,
    reflectScreen,
    reflectSwitchRows,
    isOpen,
  } = deps;

  const screenKnobInputs = new Map<ScreenKnobFieldDef["key"], HTMLInputElement>();
  for (const field of SCREEN_KNOB_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) screenKnobInputs.set(field.key, input);
  }
  const screenGapSlider = el.querySelector<HTMLInputElement>(".yui-screen-gap__slider");
  const screenGapValue = el.querySelector<HTMLSpanElement>(".yui-screen-gap__value");

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
  const screenGapMinutes = (): number =>
    Math.min(
      Math.max(Math.round(Number(screenGapSlider?.value)), SCREEN_MIN_GAP_MIN),
      SCREEN_MIN_GAP_MAX,
    );
  // Slider commits on release only — dragging must not re-time the live producer on every frame.
  function handleScreenGapInput(): void {
    if (!screenGapSlider) return;
    const minutes = screenGapMinutes();
    if (screenGapValue) screenGapValue.textContent = t("screen.min_gap_value", { n: minutes });
    screenGapSlider.style.setProperty(
      "--fill",
      String((minutes - SCREEN_MIN_GAP_MIN) / (SCREEN_MIN_GAP_MAX - SCREEN_MIN_GAP_MIN)),
    );
  }
  function handleScreenGapChange(): void {
    if (!screenKnobSettings || !screenGapSlider) return;
    screenKnobSettings.set({ min_gap_ms: screenGapMinutes() * 60_000 });
    reflectScreen();
  }

  for (const input of screenKnobInputs.values()) {
    input.addEventListener("change", handleScreenKnobChange);
    input.addEventListener("blur", reflectScreen);
  }
  screenGapSlider?.addEventListener("input", handleScreenGapInput);
  screenGapSlider?.addEventListener("change", handleScreenGapChange);

  return {
    dispose(): void {
      unsubscribeScreen?.();
      unsubscribeScreenKnobs?.();
      for (const input of screenKnobInputs.values()) {
        input.removeEventListener("change", handleScreenKnobChange);
        input.removeEventListener("blur", reflectScreen);
      }
      screenGapSlider?.removeEventListener("input", handleScreenGapInput);
      screenGapSlider?.removeEventListener("change", handleScreenGapChange);
    },
  };
}
