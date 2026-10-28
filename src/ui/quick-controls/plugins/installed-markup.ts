/** The Plugins page's Installed section: one group per plugin of the host snapshot. */

import type {
  PluginHostPlugin,
  PluginHostServer,
  PluginHostSnapshot,
} from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import { secHeadHtml } from "../markup";
import { badgeHtml, errLineHtml, esc, ICON_CHEV, SPIN, versionHtml } from "./plugin-parts";

/** What the page holds for one installed plugin beside the snapshot. */
export interface PluginUi {
  toolsOpen?: boolean;
  logOpen?: boolean;
  /** The log tail once read, or the host's rejection. */
  log?: { lines: string[] } | { error: string };
  revealError?: string;
}

/** "Check for updates": idle, the catalog reload in flight, or its result. */
export type CheckState = null | "busy" | { updates: number };

export interface InstalledView {
  snapshot: PluginHostSnapshot | null;
  ui(id: string): PluginUi;
  /** The catalog version an update would install; null when none is due. */
  updateTo(plugin: PluginHostPlugin): string | null;
  check: CheckState;
}

const DOT_CLASS: Record<PluginHostServer["status"], string> = {
  starting: "",
  running: "is-ok",
  failed: "is-bad",
  exited: "is-bad",
  stopped: "is-off",
};

function serverHtml(p: PluginHostPlugin, sv: PluginHostServer): string {
  const again = (key: string): string =>
    `<button class="yui-link-btn" type="button" data-act="retry" data-id="${esc(p.id)}" data-sid="${esc(sv.id)}" data-fk="retry:${esc(sv.id)}">${t(key)}</button>`;
  const reason = `<q>${esc(sv.reason ?? "")}</q>`;
  let state = "";
  let detail = "";
  let tail = "";
  if (sv.status === "starting") state = t("plugins.starting");
  if (sv.status === "running") {
    const n = p.tools.filter((tool) => tool.server === sv.id).length;
    state = `<b>${t("plugins.sv_running")}</b>${n ? `<span>${t("plugins.tools_n", { n })}</span>` : ""}`;
  }
  if (sv.status === "failed") {
    state = `<b>${t("plugins.sv_failed")}</b>`;
    detail = sv.phase
      ? t("plugins.sv_failed_detail", { phase: t(`plugins.phase_${sv.phase}`), reason })
      : reason;
    tail = again("plugins.retry");
  }
  if (sv.status === "exited") {
    state = `<b>${t("plugins.sv_exited")}</b>${reason}`;
    tail = again("plugins.restart");
  }
  if (sv.status === "stopped") state = t("plugins.sv_stopped");
  const dot =
    sv.status === "starting"
      ? SPIN
      : `<span class="yui-plg-dot ${DOT_CLASS[sv.status]}" aria-hidden="true"></span>`;
  return `<div class="yui-plg-sv" data-k="${esc(sv.id)}:${sv.status}">${dot}<span class="yui-plg-sv__name">${esc(sv.name)}</span><span class="yui-plg-sv__state">${state}</span>${tail}${detail ? `<span class="yui-plg-sv__detail">${detail}</span>` : ""}</div>`;
}

/** One muted line per kind and holder; the plugin keeps running without these names. */
function hiddenHtml(p: PluginHostPlugin): string {
  if (!p.hidden.length) return "";
  const groups = new Map<string, PluginHostPlugin["hidden"]>();
  for (const h of p.hidden) {
    const key = `${h.kind}|${h.holder}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const lines = [...groups.values()].map((hs) => {
    const { kind, holder } = hs[0]!;
    const names = hs.map((h) => `<span class="yui-plg-code">${esc(h.name)}</span>`).join(", ");
    const who =
      holder === "builtin"
        ? t("plugins.hidden_builtin")
        : t("plugins.hidden_by", { holder: esc(holder) });
    return `<span>${t(`plugins.hidden_${kind}`)} ${names} — ${who}</span>`;
  });
  return `<div class="yui-plg-hid" data-k="${esc(p.id)}:hid">${lines.join("")}</div>`;
}

/** The declared tools and skills; hidden names are said once, in the hidden note. */
function itemsHtml(p: PluginHostPlugin): string {
  const li = (name: string, sum: string | null): string =>
    `<li><span class="yui-plg-tools__name">${esc(name)}</span>${sum ? `<span class="yui-plg-tools__sum">${esc(sum)}</span>` : ""}</li>`;
  const tools = p.tools.map((tool) => li(tool.name, tool.description));
  const skills = p.skills.map((skill) => li(skill.name, skill.description));
  return `<ul class="yui-plg-tools">${tools.join("")}${skills.length ? `<li class="yui-plg-tools__kind">${t("plugins.skills_label")}</li>${skills.join("")}` : ""}</ul>`;
}

function countLabel(p: PluginHostPlugin): string {
  return p.skills.length
    ? t("plugins.count_both", { n: p.tools.length, m: p.skills.length })
    : t("plugins.tools_n", { n: p.tools.length });
}

function logHtml(p: PluginHostPlugin, ui: PluginUi): string {
  const id = esc(p.id);
  const log = ui.log;
  let body = "";
  let count = "";
  if (log && "error" in log) body = errLineHtml(t("plugins.err_log"), log.error);
  else if (log?.lines.length) {
    body = `<pre class="yui-plg-log" aria-label="${esc(t("plugins.log_aria", { id: p.id }))}">${esc(log.lines.join("\n"))}</pre>`;
    count = t("plugins.log_lines", { n: log.lines.length });
  } else if (log) body = `<p class="yui-plg-log__foot">${t("plugins.log_empty")}</p>`;
  const reveal = ui.revealError ? errLineHtml(t("plugins.err_reveal"), ui.revealError) : "";
  return `<div class="yui-plg-logbox" data-k="${id}:log">${body}<span class="yui-plg-log__foot">${count}<button class="yui-link-btn" type="button" data-act="reveal" data-id="${id}" data-fk="reveal:${id}">${t("plugins.log_folder")}</button></span>${reveal}</div>`;
}

function pluginHtml(p: PluginHostPlugin, v: InstalledView): string {
  const ui = v.ui(p.id);
  const id = esc(p.id);
  const reap = p.enabled && !p.consented;
  const on = p.enabled && p.consented;
  let html = `<div class="yui-group" data-k="${id}:g" data-pid="${id}">
    <div class="yui-row">
      <div class="yui-row__main">
        <span class="yui-row__label">${id} ${badgeHtml(p.source)} ${versionHtml(p.version)}</span>
        ${p.description ? `<span class="yui-row__sub yui-plg-sum" title="${esc(p.description)}">${esc(p.description)}</span>` : ""}
      </div>
      <button class="yui-switch" type="button" role="switch" aria-checked="${on}" aria-label="${esc(t("plugins.switch_aria", { id: p.id }))}" data-act="toggle" data-id="${id}" data-fk="toggle:${id}"${p.error ? " disabled" : ""}></button>
    </div>`;
  if (p.error) html += `<div>${errLineHtml(t("plugins.manifest_error"), p.error)}</div>`;
  else {
    if (reap) {
      html += `<div class="yui-plg-reap" data-k="${id}:reap"><p>${t("plugins.reapprove_note")}</p><button class="yui-pill yui-plg-ok" type="button" data-act="reapprove" data-id="${id}" data-fk="reapprove:${id}">${t("plugins.reapprove")}</button></div>`;
    } else html += p.servers.map((sv) => serverHtml(p, sv)).join("");
    html += hiddenHtml(p);
    if (p.tools.length || p.skills.length) {
      html += `<button class="yui-plg-disc" type="button" aria-expanded="${!!ui.toolsOpen}" data-act="tools" data-id="${id}" data-fk="tools:${id}">${ICON_CHEV}${countLabel(p)}</button>`;
      if (ui.toolsOpen) html += `<div data-k="${id}:tools">${itemsHtml(p)}</div>`;
    }
  }
  const to = v.updateTo(p);
  let mid = "";
  if (to)
    mid = `<button class="yui-link-btn yui-help-btn" type="button" data-act="update" data-id="${id}" data-fk="update:${id}">${t("plugins.update_to", { v: esc(to) })}</button>`;
  else if (p.source === "local")
    mid = `<span class="yui-plg-path" title="${esc(p.path)}">${esc(p.path)}</span>`;
  html += `<div class="yui-row yui-row--action"><div class="yui-plg-acts">
      <button class="yui-link-btn" type="button" aria-expanded="${!!ui.logOpen}" data-act="log" data-id="${id}" data-fk="log:${id}">${ICON_CHEV}${t("plugins.log")}</button>${mid}
      <button class="yui-link-btn yui-plg-acts__end" type="button" data-act="remove" data-id="${id}" data-fk="remove:${id}">${t(p.source === "local" ? "plugins.remove_local" : "plugins.delete")}</button></div></div>`;
  if (ui.logOpen) html += logHtml(p, ui);
  return `${html}</div>`;
}

export function installedHtml(v: InstalledView): string {
  const plugins = v.snapshot?.plugins;
  let aside = "";
  if (plugins?.length) {
    if (v.check === "busy")
      aside = `<span class="yui-sec__aside yui-plg-busy" role="status">${SPIN}${t("plugins.checking")}</span>`;
    else if (v.check)
      aside = `<span class="yui-sec__aside" role="status">${v.check.updates ? t("plugins.updates", { n: v.check.updates }) : t("plugins.up_to_date")}</span>`;
    else
      aside = `<button class="yui-link-btn" type="button" data-act="check" data-fk="check">${t("plugins.check")}</button>`;
  }
  let body: string;
  if (!plugins)
    body = `<div class="yui-group"><div class="yui-plg-state" role="status">${SPIN}${t("plugins.loading")}</div></div>`;
  else if (!plugins.length)
    body = `<div class="yui-group"><div class="yui-plg-state">${t("plugins.empty")}</div></div>`;
  else body = plugins.map((p) => pluginHtml(p, v)).join("");
  // The snapshot lists only running servers' tools, hidden names already left out.
  const n = plugins?.reduce((sum, p) => sum + p.tools.length, 0) ?? 0;
  const foot = plugins?.length ? `<p class="yui-sec__foot">${t("plugins.foot", { n })}</p>` : "";
  return `<section class="yui-sec">${secHeadHtml(t("plugins.installed_title"), aside)}${body}${foot}</section>`;
}
