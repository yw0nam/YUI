/** The General page: the language, appearance and text size segments, the user name, Help and Developer Tools. */

import { type ReactNode, useSyncExternalStore } from "react";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { GuideKey } from "../../../contract";
import type { Logger } from "../../../logger";
import {
  type createTextSizeSettings,
  TEXT_SIZES,
} from "../../../settings/appearance/text-size-settings";
import { type createThemeSettings, THEMES } from "../../../settings/appearance/theme-settings";
import type { createUserNameSettings } from "../../../settings/identity/user-name-settings";
import { Segment } from "../../controls/segment";
import {
  getLocale,
  LOCALE_DISPLAY_NAMES,
  setLocale,
  subscribe as subscribeLocale,
  t,
} from "../../i18n";
import { LANG_PICKER_ORDER } from "../constants";
import { HelpSection } from "./help/help-section";
import "./text-size-section.css";
import { UserNameRow } from "./user-name/user-name-row";

type ThemeSettingsStore = ReturnType<typeof createThemeSettings>;
type TextSizeSettingsStore = ReturnType<typeof createTextSizeSettings>;
type UserNameSettingsStore = ReturnType<typeof createUserNameSettings>;

export interface GeneralPageViewProps {
  themeSettings: ThemeSettingsStore;
  textSizeSettings: TextSizeSettingsStore;
  userNameSettings: UserNameSettingsStore;
  getPersona?: () => PersonaConfig | undefined;
  onGuide?: (guide: GuideKey, text: string) => void;
  onOpenDevtools?: () => void;
  log: Logger;
}

function SegmentRow(props: { label: string; sub: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">{props.label}</span>
        <span className="yui-row__sub">{props.sub}</span>
        {props.aside}
      </div>
      {props.children}
    </div>
  );
}

function LanguageRow({ log }: { log: Logger }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  return (
    <SegmentRow label={t("language.label")} sub={t("language.sub")}>
      <Segment
        className="yui-lang-seg"
        selectOn="activate"
        label={t("language.aria")}
        options={LANG_PICKER_ORDER.map((value) => ({ value, label: LOCALE_DISPLAY_NAMES[value] }))}
        value={locale}
        onValueChange={(next) => {
          log.info("ui_language_change", { locale: next });
          setLocale(next);
        }}
      />
    </SegmentRow>
  );
}

function AppearanceRow({ themeSettings, log }: { themeSettings: ThemeSettingsStore; log: Logger }) {
  const theme = useSyncExternalStore(themeSettings.subscribe, () => themeSettings.current().theme);
  return (
    <SegmentRow label={t("appearance.label")} sub={t("appearance.sub")}>
      <Segment
        className="yui-theme-seg"
        label={t("appearance.aria")}
        options={THEMES.map((value) => ({ value, label: t(`appearance.${value}`) }))}
        value={theme}
        onValueChange={(next) => {
          themeSettings.setTheme(next);
          log.info("theme_change", { theme: next });
        }}
      />
    </SegmentRow>
  );
}

function TextSizeRow({
  textSizeSettings,
  log,
}: {
  textSizeSettings: TextSizeSettingsStore;
  log: Logger;
}) {
  const scale = useSyncExternalStore(
    textSizeSettings.subscribe,
    () => textSizeSettings.current().scale,
  );
  return (
    <SegmentRow
      label={t("textsize.label")}
      sub={t("textsize.sub")}
      aside={<span className="yui-textsize-sample">{t("textsize.sample")}</span>}
    >
      <Segment
        className="yui-textsize-seg"
        label={t("textsize.label")}
        options={TEXT_SIZES.map((value) => ({ value, label: `${value * 100}%` }))}
        value={scale}
        onValueChange={(next) => {
          textSizeSettings.setScale(next);
          log.info("text_size_change", { scale: next });
        }}
      />
    </SegmentRow>
  );
}

function DevtoolsRow({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">{t("devtools.label")}</span>
        <span className="yui-row__sub">{t("devtools.sub")}</span>
      </div>
      <button className="yui-link-btn yui-devtools-open" type="button" onClick={onOpen}>
        {t("devtools.open")}
      </button>
    </div>
  );
}

export function GeneralPageView(props: GeneralPageViewProps) {
  return (
    <>
      {props.onGuide ? <HelpSection onGuide={props.onGuide} /> : null}
      <div className="yui-sec">
        <div className="yui-group">
          <LanguageRow log={props.log} />
          <AppearanceRow themeSettings={props.themeSettings} log={props.log} />
          <TextSizeRow textSizeSettings={props.textSizeSettings} log={props.log} />
          <UserNameRow store={props.userNameSettings} getPersona={props.getPersona} />
          {props.onOpenDevtools ? <DevtoolsRow onOpen={props.onOpenDevtools} /> : null}
        </div>
      </div>
    </>
  );
}
