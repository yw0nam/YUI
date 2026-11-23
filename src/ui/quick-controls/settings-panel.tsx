/**
 * The settings panel's view: the preset header, then the rail (the search field over the
 * character's pages and every character's pages) beside every page's panel. Each panel holds its
 * scope line, its title and its page, and one tooltip serves every trigger in the panel.
 */

import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode, Ref, RefObject } from "react";
import { isCharacterPage, type SettingsPage } from "../../settings/panels/settings-pages";
import { Tab, TabPanel, type TabsHandle, TabsRoot, useTabs } from "../controls/tabs";
import { Tip, TooltipHost, type TooltipHostHandle } from "../controls/tooltip";
import { t } from "../i18n";
import { TAB_ICONS } from "./glyphs";
import { PresetHeader, type PresetHeaderProps } from "./preset/preset-header";
import { CharacterHeadingText, ScopeLine } from "./preset/preset-scope";

interface SettingsPanelProps {
  /** The rail's pages in order: the character's pages, then every character's pages. */
  pages: readonly SettingsPage[];
  /** Each page's view, called in every render of the panel. */
  views: Partial<Record<SettingsPage, () => ReactNode>>;
  initial: SettingsPage;
  /** The preset header and each page's scope line render with it. */
  preset?: PresetHeaderProps;
  /** While it reads true, the Connection page's scope line hides. */
  connQuickShown?: { get(): boolean; subscribe(cb: () => void): () => void };
  tabs: Ref<TabsHandle>;
  onSelect(id: string): void;
  tooltip: Ref<TooltipHostHandle>;
  /** The panel-wide element the card's drop cover fills. */
  dropHost: RefObject<HTMLDivElement | null>;
}

// The selection lives here and the pages render inline, with no memo between: a rail switch
// re-renders every page in the commit that hides the old one, so a Select there closes.
export function SettingsPanel({
  pages,
  views,
  initial,
  preset,
  connQuickShown,
  tabs: handle,
  onSelect,
  tooltip,
  dropHost,
}: SettingsPanelProps) {
  const tabs = useTabs({ ids: pages, initial, onSelect, handle });
  // The character group's heading names the edited character where the panel shows a preset header.
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
    <TooltipHost handle={tooltip}>
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
              <Tip key={id} text={t(id === "react" ? "tabs.react_hint" : `tabs.${id}`)}>
                <Tab value={id} className="yui-tab" aria-label={t(`tabs.${id}`)}>
                  {TAB_ICONS[id]}
                  <span className="yui-tab__label">{t(`tabs.${id}`)}</span>
                </Tab>
              </Tip>,
            ])}
          </Tabs.List>
        </div>
        <div className="yui-quick__body">
          {pages.map((id) => (
            <TabPanel key={id} value={id} className="yui-tabpanel">
              {preset && (
                <ScopeLine
                  page={id}
                  edited={preset.edited}
                  hiddenWhile={id === "conn" ? connQuickShown : undefined}
                />
              )}
              <h1 className="yui-tabpanel__title">{t(`tabs.${id}`)}</h1>
              {views[id]?.()}
            </TabPanel>
          ))}
        </div>
      </TabsRoot>
      <div ref={dropHost} />
    </TooltipHost>
  );
}
