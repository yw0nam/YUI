/**
 * Bed scene section — the launch-bed switch and the wake-timeout row it reveals.
 * This module owns the store subscription, repaints and teardown; the shell only constructs it.
 */

import type { Logger } from "../../../../logger";
import {
  type BedSceneSettingsStore,
  WAKE_TIMEOUT_MAX_S,
  WAKE_TIMEOUT_MIN_S,
} from "../../../../settings/avatar/bed-scene-settings";
import { reflectUnlessEditing } from "../../../surfaces/reflect-unless-editing";

interface BedSceneSectionDeps {
  /** Tab root (el) — the section wrapper, switch and input are queried from here. */
  root: HTMLElement;
  settings: BedSceneSettingsStore;
  /** Skip repaints while the tab is closed. */
  isOpen: () => boolean;
  log: Logger;
}

export function createBedSceneSection(deps: BedSceneSectionDeps): {
  refresh(): void;
  dispose(): void;
} {
  const { root, settings, isOpen, log } = deps;

  const sectionEl = root.querySelector<HTMLElement>(".yui-bed-scene")!;
  const switchEl = sectionEl.querySelector<HTMLButtonElement>(".yui-bed-scene__switch")!;
  const timeoutRow = sectionEl.querySelector<HTMLElement>(".yui-bed-scene__timeout")!;
  const timeoutInput = sectionEl.querySelector<HTMLInputElement>("#yui-bed-wake-timeout")!;

  function refresh(): void {
    const s = settings.get();
    switchEl.setAttribute("aria-checked", String(s.enabled));
    timeoutRow.hidden = !s.enabled;
    reflectUnlessEditing(timeoutInput, String(s.wakeTimeoutS));
  }

  function handleSwitchClick(): void {
    const enabled = !settings.get().enabled;
    settings.setEnabled(enabled);
    log.info("bed_scene_toggle", { enabled });
  }

  // The row's min/max only bind the spinner, so a typed value is clamped here — the store must
  // never see a value outside the range the row advertises.
  function handleTimeoutChange(): void {
    const typed = Math.round(Number(timeoutInput.value));
    settings.setWakeTimeoutS(Math.min(Math.max(typed, WAKE_TIMEOUT_MIN_S), WAKE_TIMEOUT_MAX_S));
    refresh();
  }

  switchEl.addEventListener("click", handleSwitchClick);
  timeoutInput.addEventListener("change", handleTimeoutChange);
  timeoutInput.addEventListener("blur", refresh);
  const unsubscribe = settings.subscribe(() => {
    if (isOpen()) refresh();
  });

  return {
    refresh,
    dispose(): void {
      unsubscribe();
      switchEl.removeEventListener("click", handleSwitchClick);
      timeoutInput.removeEventListener("change", handleTimeoutChange);
      timeoutInput.removeEventListener("blur", refresh);
    },
  };
}
