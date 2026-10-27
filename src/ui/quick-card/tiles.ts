/** The quick card's toggle tiles: each writes its store on click and follows it live. */

import type { Logger } from "../../logger";
import { t } from "../i18n";
import type { SwitchRow } from "../quick-controls/switch-row";

export interface ListenPort {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

interface Tile {
  labelKey: string;
  get(): boolean;
  set(on: boolean): void;
  subscribe?: (cb: () => void) => () => void;
  lock?: SwitchRow["lock"];
  logKey?: string;
  /** Shown in place of the state on a tile this window cannot use. */
  unusableKey?: string;
}

const fromRow = (labelKey: string, row: SwitchRow): Tile => ({
  labelKey,
  get: row.getEnabled,
  set: row.setEnabled,
  subscribe: row.subscribe,
  lock: row.lock,
  logKey: row.logKey,
});

export function createTiles(deps: {
  rows: { voice: SwitchRow; bubble: SwitchRow; unified: SwitchRow };
  /** Null where voice input belongs to another window: the tile is disabled. */
  listen: ListenPort | null;
  log: Logger;
}): { el: HTMLElement; dispose(): void } {
  const { rows, listen, log } = deps;
  const tiles: Tile[] = [
    fromRow("quick_card.voice", rows.voice),
    listen
      ? { labelKey: "quick_card.listen", ...listen }
      : {
          labelKey: "quick_card.listen",
          get: () => false,
          set: () => {},
          unusableKey: "quick_card.main_only",
        },
    fromRow("quick_card.bubble", rows.bubble),
    fromRow("quick_card.unified", rows.unified),
  ];
  const el = document.createElement("div");
  el.className = "yui-qcard__tiles";
  const buttons = tiles.map((tile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-qcard__tile";
    button.setAttribute("role", "switch");
    const label = document.createElement("span");
    label.className = "yui-qcard__tile-label";
    label.textContent = t(tile.labelKey);
    const state = document.createElement("span");
    state.className = "yui-qcard__tile-state";
    button.append(label, state);
    button.addEventListener("click", () => {
      if (tile.unusableKey || tile.lock?.get()) return;
      const next = !tile.get();
      tile.set(next);
      if (tile.logKey) log.info(tile.logKey, { enabled: next });
    });
    return { tile, button, state };
  });
  el.append(...buttons.map((b) => b.button));

  function paint(): void {
    for (const { tile, button, state } of buttons) {
      // The store keeps its value while locked, so unlocking shows it again.
      const locked = tile.lock?.get() === true;
      const on = !locked && tile.get();
      button.setAttribute("aria-checked", String(on));
      button.disabled = locked || !!tile.unusableKey;
      button.title = locked ? t(tile.lock!.reasonKey) : "";
      state.textContent = t(tile.unusableKey ?? (on ? "quick_card.on" : "quick_card.off"));
    }
  }
  paint();
  const unsubscribes = tiles.flatMap((tile) =>
    [tile.subscribe, tile.lock?.subscribe].flatMap((subscribe) =>
      subscribe ? [subscribe(paint)] : [],
    ),
  );

  return {
    el,
    dispose: () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
