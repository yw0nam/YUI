/**
 * The settings panel's view: the preset strip, then the rail (the search field over the
 * character's pages and every character's pages) beside every page's panel. Each panel holds its
 * scope line, its title and the host its page mounts into.
 */

import { Tabs } from "@base-ui/react/tabs";
import type { Ref } from "react";
import { CHARACTER_PAGES, type SettingsPage } from "../../settings/panels/settings-pages";
import { Tab, TabPanel, type TabsHandle, TabsRoot, useTabs } from "../controls/tabs";
import { t } from "../i18n";
import { TAB_ICONS } from "./glyphs";
import { PresetHeader, type PresetHeaderProps } from "./preset/preset-header";
import { CharacterHeadingText, ScopeLine } from "./preset/preset-scope";

/** The element each page mounts into, and the panel-wide one the card's drop cover fills. */
export type PageHosts = Partial<Record<SettingsPage | "drop", HTMLElement>>;

export interface SettingsPanelProps {
  /** The rail's pages in order: the character's pages, then every character's pages. */
  pages: readonly SettingsPage[];
  initial: SettingsPage;
  /** The preset strip and each page's scope line render with it. */
  preset?: PresetHeaderProps;
  tabs: Ref<TabsHandle>;
  onSelect(id: string): void;
  /** Filled with each host as it commits. */
  hosts: PageHosts;
}

const isCharacterPage = (id: SettingsPage): boolean =>
  (CHARACTER_PAGES as readonly string[]).includes(id);

export function SettingsPanel({
  pages,
  initial,
  preset,
  tabs: handle,
  onSelect,
  hosts,
}: SettingsPanelProps) {
  const tabs = useTabs({ ids: pages, initial, onSelect, handle });
  const host =
    (key: SettingsPage | "drop") =>
    (node: HTMLElement | null): void => {
      if (node) hosts[key] = node;
    };
  // The character group's heading names the edited character where the panel shows a preset strip.
  const group = (id: "character" | "app") => (
    <p key={id} className="yui-tabs__group" role="presentation" data-rail-group={id}>
      {id === "character" && preset ? (
        <CharacterHeadingText edited={preset.edited} />
      ) : (
        t(`rail.group_${id}`)
      )}
    </p>
  );
  const firstApp = pages.find((id) => !isCharacterPage(id));

  return (
    <>
      {preset && <PresetHeader {...preset} />}
      <TabsRoot tabs={tabs} orientation="vertical" className="yui-quick__cols">
        <div className="yui-rail">
          <input
            className="yui-search__input"
            type="search"
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
          <Tabs.List className="yui-tabs" aria-label={t("panel.tablist_label")} activateOnFocus>
            {pages.flatMap((id, i) => [
              ...(i === 0 ? [group("character")] : id === firstApp ? [group("app")] : []),
              <Tab
                key={id}
                value={id}
                className="yui-tab"
                data-tip={t(id === "react" ? "tabs.react_hint" : `tabs.${id}`)}
                aria-label={t(`tabs.${id}`)}
              >
                {TAB_ICONS[id]}
                <span className="yui-tab__label">{t(`tabs.${id}`)}</span>
              </Tab>,
            ])}
          </Tabs.List>
        </div>
        <div className="yui-quick__body">
          {pages.map((id) => (
            <TabPanel key={id} value={id} className="yui-tabpanel">
              {preset && <ScopeLine page={id} edited={preset.edited} />}
              <h1 className="yui-tabpanel__title">{t(`tabs.${id}`)}</h1>
              <div ref={host(id)} />
            </TabPanel>
          ))}
        </div>
      </TabsRoot>
      <div ref={host("drop")} />
    </>
  );
}
