/** The Plugins page's Available section: the catalog entries not installed, then Add from folder. */

import type { CatalogEntry } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import { PLUS_SVG } from "../constants";
import { secHeadHtml } from "../markup";
import { badgeHtml, errLineHtml, esc, type Failure, SPIN, versionHtml } from "./plugin-parts";

/** An install started from a catalog row: in flight, or the host's rejection. */
export interface InstallUi {
  installing?: boolean;
  error?: Failure;
}

export interface CatalogView {
  state: "loading" | "error" | "ok";
  /** Only the entries not installed. */
  entries: CatalogEntry[];
  /** The host's rejection when `state` is `error`. */
  error: string;
  install(id: string): InstallUi;
  folder: { busy: boolean; error?: Failure };
}

function errHtml(c: CatalogEntry, ui: InstallUi): string {
  if (c.error) return errLineHtml(t("plugins.manifest_error"), c.error);
  if (!ui.error) return "";
  const id = esc(c.id);
  return errLineHtml(
    t(ui.error.lead),
    ui.error.message,
    `<button class="yui-link-btn" type="button" data-act="install" data-cid="${id}" data-fk="again:${id}">${t("plugins.retry")}</button>`,
  );
}

function rowHtml(c: CatalogEntry, ui: InstallUi): string {
  const id = esc(c.id);
  let side = "";
  if (ui.installing)
    side = `<span class="yui-plg-busy" role="status">${SPIN}${t("plugins.installing")}</span>`;
  else if (!c.error)
    side = `<button class="yui-pill" type="button" data-act="install" data-cid="${id}" data-fk="install:${id}" aria-label="${esc(t("plugins.install_aria", { id: c.id }))}">${t("plugins.install")}</button>`;
  return `<div><div class="yui-row">
      <div class="yui-row__main">
        <span class="yui-row__label">${id} ${badgeHtml(c.source)} ${versionHtml(c.version)}</span>
        ${c.summary ? `<span class="yui-row__sub yui-plg-sum" title="${esc(c.summary)}">${esc(c.summary)}</span>` : ""}
      </div>
      ${side ? `<div class="yui-plg-side">${side}</div>` : ""}
    </div>${errHtml(c, ui)}</div>`;
}

export function catalogHtml(v: CatalogView): string {
  let list: string;
  if (v.state === "loading") {
    const skel = `<div class="yui-plg-skelrow"><span class="yui-plg-skel"></span><span class="yui-plg-skel"></span></div>`;
    list = `<div class="yui-plg-state" role="status" aria-busy="true">${SPIN}${t("plugins.catalog_loading")}</div>${skel}${skel}`;
  } else if (v.state === "error") {
    list = `<div>${errLineHtml(t("plugins.err_catalog"), v.error, `<button class="yui-link-btn" type="button" data-act="cat-retry" data-fk="cat-retry">${t("plugins.retry")}</button>`)}</div>`;
  } else {
    list = v.entries.length
      ? v.entries.map((c) => rowHtml(c, v.install(c.id))).join("")
      : `<div class="yui-plg-state">${t("plugins.catalog_empty")}</div>`;
  }
  const add = v.folder.busy
    ? `<span class="yui-plg-busy" role="status">${SPIN}${t("plugins.reading_folder")}</span>`
    : `<button class="yui-add-btn" type="button" data-act="folder" data-fk="folder">${PLUS_SVG}${t("plugins.add_folder")}</button>`;
  const folderErr = v.folder.error
    ? `<div>${errLineHtml(t(v.folder.error.lead), v.folder.error.message)}</div>`
    : "";
  return `<section class="yui-sec">${secHeadHtml(t("plugins.available_title"))}
    <p class="yui-sec__note">${t("plugins.catalog_note")}</p>
    <div class="yui-group">${list}<div class="yui-row yui-row--action">${add}</div>${folderErr}</div>
    <p class="yui-sec__foot">${t("plugins.local_foot")}</p></section>`;
}
