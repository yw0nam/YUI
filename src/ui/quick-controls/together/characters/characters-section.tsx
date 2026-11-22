/** The Together page's character rows: one row per preset with its face, state, and an "On the desktop" switch. */

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import { OPEN_PRESET_CAP, type PetWindows } from "../../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../../settings/preset/preset-registry";
import { Switch } from "../../../controls/switch";
import { t } from "../../../i18n";
import { useSnapshot } from "../../../quick-card/use-snapshot";
import { avatarEl } from "../../../unified/avatar";
import "./characters-section.css";

export type WindowsPort = Pick<PetWindows, "get" | "open" | "close" | "subscribe" | "invalidate">;

/** The preset's face, mounted as a vanilla element the re-renders keep in place. */
function Face({ entry }: { entry: PresetEntry }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => host.current?.replaceChildren(avatarEl(entry, 28)), [entry]);
  return <span ref={host} />;
}

function CharacterRow({
  entry,
  main,
  own,
  open,
  full,
  petWindows,
  log,
}: {
  entry: PresetEntry;
  main: boolean;
  own: boolean;
  open: boolean;
  full: boolean;
  petWindows: WindowsPort;
  log: Logger;
}) {
  const on = main || own || open;
  const capped = !on && full;
  function toggle(): void {
    const wasOpen = petWindows.get().includes(entry.id);
    if (wasOpen) petWindows.close(entry.id);
    else if (!petWindows.open(entry.id)) {
      // Another window took the last place first; the re-read shows the reason without a log.
      petWindows.invalidate();
      return;
    }
    log.info("character_desktop_toggle", { preset: entry.id, on: !wasOpen });
  }
  return (
    // Search owns a row's classes, so the off state rides a data attribute.
    <div className="yui-row yui-chars__row" data-off={on ? undefined : ""}>
      <Face entry={entry} />
      <div className="yui-row__main">
        <span className="yui-row__label">{entry.name}</span>
        <span className="yui-row__sub yui-chars__meta">
          {t(main ? "chars.in_main" : on ? "chars.on" : "chars.off")}
        </span>
        <span className="yui-row__sub yui-chars__reason" hidden={!(capped || (own && !main))}>
          {own ? t("chars.this_window") : t("chars.cap_reason", { cap: OPEN_PRESET_CAP })}
        </span>
      </div>
      <Switch
        checked={on}
        disabled={main || own || capped}
        label={t("chars.switch_aria", { name: entry.name })}
        onCheckedChange={toggle}
      />
    </div>
  );
}

export function CharactersSection({
  registry,
  petWindows,
  boundId,
  log,
}: {
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows: WindowsPort;
  /** A bound window's own preset; turning it off would close the window showing this list. */
  boundId: string | null;
  log: Logger;
}) {
  // The registry clones on read, so the box keeps the value until the next notify.
  const { active, list } = useSnapshot(registry.get, registry.subscribe);
  // The open ids read as one primitive, so a refused open's re-read repaints the rows.
  const openIds = useSyncExternalStore(petWindows.subscribe, () => petWindows.get().join(" "));
  const open = openIds ? openIds.split(" ") : [];
  const count = new Set([active, ...open]).size;
  const full = count >= OPEN_PRESET_CAP;
  return (
    <div className="yui-sec yui-chars">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("chars.section")}</h2>
        <span className="yui-sec__state yui-chars__count">
          {t("chars.count", { n: count, cap: OPEN_PRESET_CAP })}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: the row group the panel's shared row CSS styles */}
      <div className="yui-group yui-chars__rows" role="group" aria-label={t("chars.section")}>
        {list.map((entry) => (
          <CharacterRow
            key={entry.id}
            entry={entry}
            main={entry.id === active}
            own={entry.id === boundId}
            open={open.includes(entry.id)}
            full={full}
            petWindows={petWindows}
            log={log}
          />
        ))}
      </div>
    </div>
  );
}
