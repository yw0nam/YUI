/** The quick card's toggle tiles: each writes its store on click and follows it live. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import type { SwitchRow } from "../quick-controls/switch-row";

export interface ListenPort {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

interface TileSpec {
  labelKey: string;
  get(): boolean;
  set(on: boolean): void;
  subscribe?: (cb: () => void) => () => void;
  lock?: SwitchRow["lock"];
  logKey?: string;
  /** Shown in place of the state on a tile this window cannot use. */
  unusableKey?: string;
}

const fromRow = (labelKey: string, row: SwitchRow): TileSpec => ({
  labelKey,
  get: row.getEnabled,
  set: row.setEnabled,
  subscribe: row.subscribe,
  lock: row.lock,
  logKey: row.logKey,
});

const never = () => () => {};
const no = () => false;

function Tile({ tile, log }: { tile: TileSpec; log: Logger }) {
  const stored = useSyncExternalStore(tile.subscribe ?? never, tile.get);
  const locked = useSyncExternalStore(tile.lock?.subscribe ?? never, tile.lock?.get ?? no);
  // The store keeps its value while locked, so unlocking shows it again.
  const on = !locked && stored;
  return (
    <button
      type="button"
      className="yui-qcard__tile"
      role="switch"
      aria-checked={on}
      disabled={locked || !!tile.unusableKey}
      title={locked ? t(tile.lock!.reasonKey) : undefined}
      onClick={() => {
        if (tile.unusableKey || tile.lock?.get()) return;
        const next = !tile.get();
        tile.set(next);
        if (tile.logKey) log.info(tile.logKey, { enabled: next });
      }}
    >
      <span className="yui-qcard__tile-label">{t(tile.labelKey)}</span>
      <span className="yui-qcard__tile-state">
        {t(tile.unusableKey ?? (on ? "quick_card.on" : "quick_card.off"))}
      </span>
    </button>
  );
}

export function Tiles({
  rows,
  listen,
  log,
}: {
  rows: { voice: SwitchRow; bubble: SwitchRow; unified: SwitchRow };
  /** Null where voice input belongs to another window: the tile is disabled. */
  listen: ListenPort | null;
  log: Logger;
}) {
  const tiles: TileSpec[] = [
    fromRow("quick_card.voice", rows.voice),
    listen
      ? { labelKey: "quick_card.listen", ...listen }
      : {
          labelKey: "quick_card.listen",
          get: no,
          set: () => {},
          unusableKey: "quick_card.main_only",
        },
    fromRow("quick_card.bubble", rows.bubble),
    fromRow("quick_card.unified", rows.unified),
  ];
  return (
    <div className="yui-qcard__tiles">
      {tiles.map((tile) => (
        <Tile key={tile.labelKey} tile={tile} log={log} />
      ))}
    </div>
  );
}
