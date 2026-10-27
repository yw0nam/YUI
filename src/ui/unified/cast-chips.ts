/**
 * The unified chat window's head row — the recipient picker: one radio chip per open character (its
 * face, its name, a dot for the state of its line), one for everyone, and the window's × button.
 * The row's empty space is the window's drag handle.
 */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { avatarEl } from "./avatar";
import { EVERYONE, type Mention } from "./targets";

/** talk: its line holds the box; think: its turn runs or its line waits for the box. */
export type CastState = "talk" | "think" | "idle";

const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export interface CastChips {
  /** checked: the recipient the row shows as where Enter sends. */
  render(
    cast: readonly PresetEntry[],
    stateOf: (id: string) => CastState,
    checked: Mention | undefined,
  ): void;
  dispose(): void;
}

export function createCastChips(deps: {
  mount: HTMLElement;
  onClose: () => void;
  startDragging: () => void;
  onPick: (id: Mention) => void;
}): CastChips {
  const row = document.createElement("div");
  row.className = "yui-uc__cast";
  const chips = document.createElement("div");
  chips.className = "yui-uc__chips";
  chips.setAttribute("role", "radiogroup");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "yui-uc__close";
  close.innerHTML = CROSS;
  row.append(chips, close);
  deps.mount.append(row);

  const applyLabels = (): void => {
    chips.setAttribute("aria-label", t("unified.recipients"));
    close.setAttribute("aria-label", t("unified.close"));
  };
  applyLabels();
  const unsubscribeLocale = subscribeLocale(applyLabels);

  let built: string | undefined;
  const radios = (): HTMLElement[] => [...chips.querySelectorAll<HTMLElement>("[role=radio]")];
  const focusChip = (id: string | undefined): void =>
    radios()
      .find((r) => r.dataset.id === id)
      ?.focus();

  function chip(id: Mention, label: string, entry?: PresetEntry): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-uc__chip";
    button.setAttribute("role", "radio");
    button.dataset.id = id;
    const name = document.createElement("span");
    name.className = "yui-uc__chip-name";
    name.textContent = label;
    if (!entry) {
      button.append(name);
      return button;
    }
    const dot = document.createElement("span");
    dot.className = "yui-uc__chip-dot";
    dot.setAttribute("aria-hidden", "true");
    button.append(avatarEl(entry, 22), name, dot);
    return button;
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    deps.startDragging();
  };
  const onClick = (e: MouseEvent): void => {
    const id = (e.target as Element).closest<HTMLElement>("[role=radio]")?.dataset.id;
    if (id !== undefined) deps.onPick(id);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const all = radios();
    const at = all.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? all.length - 1
          : e.key in STEP
            ? (at + STEP[e.key]! + all.length) % all.length
            : null;
    if (next === null) return;
    e.preventDefault();
    const id = all[next]!.dataset.id!;
    deps.onPick(id);
    focusChip(id);
  };
  row.addEventListener("pointerdown", onPointerDown);
  chips.addEventListener("click", onClick);
  chips.addEventListener("keydown", onKeyDown);
  close.addEventListener("click", deps.onClose);

  return {
    render(cast, stateOf, checked) {
      // Rebuilt only when the cast changes, so a press and its click land on the same button.
      const key = JSON.stringify(cast);
      if (key !== built) {
        built = key;
        chips.replaceChildren(...cast.map((e) => chip(e.id, e.name, e)), chip(EVERYONE, ""));
      }
      for (const r of radios()) {
        const id = r.dataset.id!;
        if (id === EVERYONE)
          r.querySelector(".yui-uc__chip-name")!.textContent = t("unified.everyone");
        else r.dataset.state = stateOf(id);
        r.setAttribute("aria-checked", String(id === checked));
        r.tabIndex = id === checked ? 0 : -1;
      }
    },
    dispose() {
      unsubscribeLocale();
      row.removeEventListener("pointerdown", onPointerDown);
      chips.removeEventListener("click", onClick);
      chips.removeEventListener("keydown", onKeyDown);
      close.removeEventListener("click", deps.onClose);
      row.remove();
    },
  };
}
