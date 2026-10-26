/**
 * The unified chat window's head row — one chip per open character (its face, its name, a dot for
 * the state of its line) and the window's × button. The row is the window's drag handle.
 */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { avatarEl } from "./avatar";

/** talk: its line holds the box; think: its turn runs or its line waits for the box. */
export type CastState = "talk" | "think" | "idle";

const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export interface CastChips {
  render(cast: readonly PresetEntry[], stateOf: (id: string) => CastState): void;
  dispose(): void;
}

export function createCastChips(deps: {
  mount: HTMLElement;
  onClose: () => void;
  startDragging: () => void;
}): CastChips {
  const row = document.createElement("div");
  row.className = "yui-uc__cast";
  const chips = document.createElement("ul");
  chips.className = "yui-uc__chips";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "yui-uc__close";
  close.innerHTML = CROSS;
  row.append(chips, close);
  deps.mount.append(row);

  const applyLabels = (): void => close.setAttribute("aria-label", t("unified.close"));
  applyLabels();
  const unsubscribeLocale = subscribeLocale(applyLabels);

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    deps.startDragging();
  };
  row.addEventListener("pointerdown", onPointerDown);
  close.addEventListener("click", deps.onClose);

  return {
    render(cast, stateOf) {
      chips.replaceChildren(
        ...cast.map((entry) => {
          const chip = document.createElement("li");
          chip.className = "yui-uc__chip";
          chip.dataset.state = stateOf(entry.id);
          const name = document.createElement("span");
          name.className = "yui-uc__chip-name";
          name.textContent = entry.name;
          const dot = document.createElement("span");
          dot.className = "yui-uc__chip-dot";
          dot.setAttribute("aria-hidden", "true");
          chip.append(avatarEl(entry, 22), name, dot);
          return chip;
        }),
      );
    },
    dispose() {
      unsubscribeLocale();
      row.removeEventListener("pointerdown", onPointerDown);
      close.removeEventListener("click", deps.onClose);
      row.remove();
    },
  };
}
