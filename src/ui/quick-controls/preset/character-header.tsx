/**
 * The settings window's character header: one button per preset with its face, name, transport and
 * window state. A click hands the preset to edit to `onPick`; a preset in no window is dimmed and
 * stays editable.
 */

import { readChatApiOverride } from "../../../settings/backend/endpoints-settings";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import { t } from "../../i18n";
import { avatarEl } from "../../unified/avatar";
import { characterMeta } from "./character-meta";
import { usePrepended } from "./use-prepended";

function Item(p: {
  entry: PresetEntry;
  off: boolean;
  current: boolean;
  meta: string;
  onClick(): void;
}) {
  // The face, mounted as a vanilla element the re-renders keep in place.
  const { host: item } = usePrepended<HTMLButtonElement>(() => avatarEl(p.entry, 28), [p.entry]);
  return (
    <button
      ref={item}
      type="button"
      className={p.off ? "yui-chead__item is-off" : "yui-chead__item"}
      data-preset-id={p.entry.id}
      aria-current={p.current}
      onClick={p.onClick}
    >
      <span className="yui-chead__text">
        <span className="yui-chead__name">{p.entry.name}</span>
        <span className="yui-chead__meta">{p.meta}</span>
      </span>
    </button>
  );
}

export function CharacterHeader(p: {
  /** The preset the window edits. */
  shownId: string;
  list: readonly PresetEntry[];
  main: string;
  isOpen: (id: string) => boolean;
  getDefaultChatApi?: () => string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the header row the preset header's CSS styles
    <div className="yui-chead" role="group" aria-label={t("chars.section")}>
      {p.list.map((entry) => {
        const { state, line } = characterMeta({
          id: entry.id,
          main: p.main,
          isOpen: p.isOpen,
          chatApiOverride: readChatApiOverride(entry.id),
          defaultChatApi: p.getDefaultChatApi?.(),
        });
        return (
          <Item
            key={entry.id}
            entry={entry}
            off={state === "head.off"}
            current={entry.id === p.shownId}
            meta={line}
            onClick={() => {
              if (entry.id !== p.shownId) p.onPick(entry.id);
            }}
          />
        );
      })}
    </div>
  );
}
