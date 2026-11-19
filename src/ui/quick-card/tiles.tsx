/** The quick card's toggle tiles: each writes its store on click and follows it live. */

import type { Logger } from "../../logger";
import type { SwitchRow } from "../quick-controls/switch-row";
import { fromExternal } from "./external";
import { tr } from "./locale";

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

function TileButton(props: { tile: Tile; log: Logger }) {
  const { tile, log } = props;
  const stored = fromExternal(tile.get, tile.subscribe);
  const locked = fromExternal(() => tile.lock?.get() === true, tile.lock?.subscribe);
  // The store keeps its value while locked, so unlocking shows it again.
  const on = () => !locked() && stored();
  return (
    <button
      type="button"
      class="yui-qcard__tile"
      role="switch"
      aria-checked={on() ? "true" : "false"}
      disabled={locked() || !!tile.unusableKey}
      title={locked() ? tr(tile.lock!.reasonKey) : ""}
      onClick={() => {
        if (tile.unusableKey || tile.lock?.get()) return;
        const next = !tile.get();
        tile.set(next);
        if (tile.logKey) log.info(tile.logKey, { enabled: next });
      }}
    >
      <span class="yui-qcard__tile-label">{tr(tile.labelKey)}</span>
      <span class="yui-qcard__tile-state">
        {tr(tile.unusableKey ?? (on() ? "quick_card.on" : "quick_card.off"))}
      </span>
    </button>
  );
}

export function Tiles(props: {
  rows: { voice: SwitchRow; bubble: SwitchRow; unified: SwitchRow };
  /** Null where voice input belongs to another window: the tile is disabled. */
  listen: ListenPort | null;
  log: Logger;
}) {
  const { rows, listen, log } = props;
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
  return (
    <div class="yui-qcard__tiles">
      {tiles.map((tile) => (
        <TileButton tile={tile} log={log} />
      ))}
    </div>
  );
}
