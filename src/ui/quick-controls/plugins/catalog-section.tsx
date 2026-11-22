/** The Available plugins section: the catalog entries not installed, then Add from folder. */

import type { KeyboardEvent, ReactNode } from "react";
import type { CatalogEntry } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import { Badge, ErrLine, PLUS_ICON, SectionHead, Spinner, Version } from "./plugin-parts";
import type { PluginsState } from "./plugins-state";

function InstallRow({ entry, state }: { entry: CatalogEntry; state: PluginsState }) {
  const ui = state.installOf(entry.id);
  const side: ReactNode = ui.installing ? (
    <span className="yui-plg-busy" role="status">
      <Spinner />
      {t("plugins.installing")}
    </span>
  ) : entry.error ? null : (
    <button
      className="yui-pill"
      type="button"
      aria-label={t("plugins.install_aria", { id: entry.id })}
      onClick={() => state.install(entry.id)}
    >
      {t("plugins.install")}
    </button>
  );
  return (
    <div>
      <div className="yui-row">
        <div className="yui-row__main">
          <span className="yui-row__label">
            {entry.id} <Badge source={entry.source} /> <Version version={entry.version} />
          </span>
          {entry.summary ? (
            <span className="yui-row__sub yui-plg-sum" title={entry.summary}>
              {entry.summary}
            </span>
          ) : null}
        </div>
        {side ? <div className="yui-plg-side">{side}</div> : null}
      </div>
      {entry.error ? (
        <ErrLine lead={t("plugins.manifest_error")} message={entry.error} />
      ) : ui.error ? (
        <ErrLine
          lead={t(ui.error.lead)}
          message={ui.error.message}
          tail={
            <button className="yui-link-btn" type="button" onClick={() => state.install(entry.id)}>
              {t("plugins.retry")}
            </button>
          }
        />
      ) : null}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="yui-plg-skelrow">
      <span className="yui-plg-skel"></span>
      <span className="yui-plg-skel"></span>
    </div>
  );
}

export function CatalogSection({
  state,
  onKeyDown,
}: {
  state: PluginsState;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}) {
  const installed = new Set(state.snapshot()?.plugins?.map((plugin) => plugin.id) ?? []);
  const list = state.catalog.list(installed);
  let rows: ReactNode;
  if (list.state === "loading")
    rows = (
      <>
        <div className="yui-plg-state" role="status" aria-busy="true">
          <Spinner />
          {t("plugins.catalog_loading")}
        </div>
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  else if (list.state === "error")
    rows = (
      <div>
        <ErrLine
          lead={t("plugins.err_catalog")}
          message={list.error}
          tail={
            <button className="yui-link-btn" type="button" onClick={() => state.catRetry()}>
              {t("plugins.retry")}
            </button>
          }
        />
      </div>
    );
  else
    rows = list.entries.length ? (
      list.entries.map((entry) => <InstallRow key={entry.id} entry={entry} state={state} />)
    ) : (
      <div className="yui-plg-state">{t("plugins.catalog_empty")}</div>
    );
  const folder = state.folder;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape inside the page closes its own panels
    <section className="yui-sec" onKeyDown={onKeyDown}>
      <SectionHead title={t("plugins.available_title")} />
      <p className="yui-sec__note">{t("plugins.catalog_note")}</p>
      <div className="yui-group">
        {rows}
        <div className="yui-row yui-row--action">
          {folder.busy ? (
            <span className="yui-plg-busy" role="status">
              <Spinner />
              {t("plugins.reading_folder")}
            </span>
          ) : (
            <button className="yui-add-btn" type="button" onClick={() => state.addFolder()}>
              {PLUS_ICON}
              {t("plugins.add_folder")}
            </button>
          )}
        </div>
        {folder.error ? (
          <div>
            <ErrLine lead={t(folder.error.lead)} message={folder.error.message} />
          </div>
        ) : null}
      </div>
      <p className="yui-sec__foot">{t("plugins.local_foot")}</p>
    </section>
  );
}
