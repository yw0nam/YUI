/** The Plugins page's Installed section: one group per plugin of the host snapshot. */

import type {
  PluginHostPlugin,
  PluginHostServer,
  PluginHostSnapshot,
} from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import { TAB_ICON_PERMS } from "../constants";
import { secHeadHtml } from "../markup";
import {
  badgeHtml,
  errLineHtml,
  esc,
  type Failure,
  ICON_CHEV,
  SOURCES,
  SPIN,
  versionHtml,
} from "./plugin-parts";

/** What the page holds for one installed plugin beside the snapshot. */
export interface PluginUi {
  /** The consent panel: step 1 asks, enable runs, then the snapshot picks the step-2 panel. */
  flow?: "step1" | "enabling" | "enabled";
  /** The inline remove confirm is open. */
  confirm?: boolean;
  /** An update is in flight. */
  updating?: boolean;
  /** The last managing call's rejection. */
  error?: Failure;
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

function serverHtml(p: PluginHostPlugin, sv: PluginHostServer, busy: boolean): string {
  const again = (key: string): string =>
    `<button class="yui-link-btn" type="button" data-act="retry" data-id="${esc(p.id)}" data-sid="${esc(sv.id)}" data-fk="retry:${esc(sv.id)}"${busy ? " disabled" : ""}>${t(key)}</button>`;
  const reason = `<q>${esc(sv.reason ?? "")}</q>`;
  let state = "";
  let detail = "";
  let tail = "";
  if (sv.status === "starting") state = t("plugins.starting");
  if (sv.status === "running") state = `<b>${t("plugins.sv_running")}</b>`;
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
      : `<span class="yui-chat-status__dot ${DOT_CLASS[sv.status]}" aria-hidden="true"></span>`;
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
    const key = `plugins.hidden_${kind}_${holder === "builtin" ? "builtin" : "by"}`;
    return `<span>${t(key, { names, holder: esc(holder) })}</span>`;
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

function stepHtml(n: 1 | 2): string {
  return `<p class="yui-plg-consent__step"><i class="on"></i><i${n === 2 ? ' class="on"' : ""}></i>${t("plugins.step", { n })}</p>`;
}

function stepOneHtml(p: PluginHostPlugin): string {
  const id = esc(p.id);
  const many = p.servers.length > 1;
  const cmds = p.servers
    .map(
      (sv) =>
        `<code class="yui-plg-cmd">${many ? `<b>${esc(sv.name)}</b> ` : ""}${esc(sv.command)}</code>`,
    )
    .join("");
  const { warning } = SOURCES[p.source];
  const extra = warning
    ? `<p class="yui-plg-warn${warning.strong ? " yui-plg-warn--strong" : ""}">${warning.icon}<span>${t(warning.key)}</span></p>`
    : "";
  const question =
    p.enabled && !p.consented ? t("plugins.consent_q_reapprove") : t("plugins.consent_q", { id });
  return `<div class="yui-plg-consent" data-k="${id}:consent" role="group" aria-label="${esc(t("plugins.consent_aria", { id: p.id }))}">
      ${stepHtml(1)}
      <p class="yui-plg-consent__q">${question}</p>
      <dl class="yui-plg-facts">
        <dt>${t("plugins.fact_source")}</dt><dd>${badgeHtml(p.source)} <small>${t(SOURCES[p.source].review)}</small><br><span>${esc(p.path)}</span></dd>
        <dt>${t("plugins.fact_version")}</dt><dd>${p.version ? t("plugins.version", { version: esc(p.version) }) : `<small>${t("plugins.no_version")}</small>`}</dd>
        <dt>${t("plugins.fact_command")}</dt><dd>${cmds || `<small>${t("plugins.no_servers")}</small>`}</dd>
      </dl>
      <p class="yui-plg-warn">${TAB_ICON_PERMS}<span>${t("plugins.shield")}</span></p>${extra}
      <div class="yui-plg-btns">
        <button class="yui-pill" type="button" data-act="cancel" data-id="${id}" data-fk="cancel:${id}">${t("plugins.cancel")}</button>
        <button class="yui-pill yui-pill--ok" type="button" data-act="allow" data-id="${id}" data-fk="allow:${id}">${t("plugins.allow")}</button>
      </div></div>`;
}

/** Once enabled, the current snapshot picks the panel: starting, failed, or step 2. */
function stepTwoPanel(p: PluginHostPlugin): "starting" | "failed" | "started" {
  if (p.servers.some((sv) => sv.status === "starting")) return "starting";
  if (p.servers.some((sv) => sv.status === "failed" || sv.status === "exited")) return "failed";
  return "started";
}

function consentHtml(p: PluginHostPlugin, flow: PluginUi["flow"]): string {
  if (flow === "step1") return stepOneHtml(p);
  if (!flow) return "";
  const panel = flow === "enabling" ? "starting" : stepTwoPanel(p);
  const id = esc(p.id);
  const btns = (note: string, okKey: string): string =>
    `<div class="yui-plg-btns"><span class="yui-plg-btns__note">${t(note)}</span>
        <button class="yui-pill" type="button" data-act="off" data-id="${id}" data-fk="off:${id}">${t("plugins.turn_off")}</button>
        <button class="yui-pill yui-pill--ok" type="button" data-act="done" data-id="${id}" data-fk="done:${id}">${t(okKey)}</button></div>`;
  if (panel === "starting")
    return `<div class="yui-plg-consent" data-k="${id}:starting">${stepHtml(2)}<div class="yui-plg-wait" role="status">${SPIN}${t("plugins.starting")}</div></div>`;
  if (panel === "started") {
    const any = p.tools.length || p.skills.length;
    const question = !any
      ? t("plugins.started_none")
      : p.skills.length
        ? t("plugins.started_both", { n: p.tools.length, m: p.skills.length })
        : t("plugins.started_tools", { n: p.tools.length });
    return `<div class="yui-plg-consent" data-k="${id}:started" role="group" aria-label="${esc(t("plugins.step2_aria", { id: p.id }))}">
      ${stepHtml(2)}<p class="yui-plg-consent__q">${question}</p>${any ? itemsHtml(p) : ""}${hiddenHtml(p)}${btns("plugins.backend_decides", "plugins.ok")}</div>`;
  }
  return `<div class="yui-plg-consent" data-k="${id}:failed" role="group" aria-label="${esc(t("plugins.failed_aria", { id: p.id }))}">
      ${stepHtml(2)}<p class="yui-plg-consent__q">${t("plugins.failed_q")}</p><div class="yui-group">${p.servers.map((sv) => serverHtml(p, sv, false)).join("")}</div>${btns("plugins.keep_on_note", "plugins.keep_on")}</div>`;
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
  const awaitsReapproval = p.enabled && !p.consented;
  const busy = !!ui.updating;
  const disabledWhileUpdating = busy ? " disabled" : "";
  const checked = ui.flow === "step1" ? "mixed" : String(p.enabled && p.consented);
  let html = `<div class="yui-group" data-k="${id}:g" data-pid="${id}">
    <div class="yui-row">
      <div class="yui-row__main">
        <span class="yui-row__label">${id} ${badgeHtml(p.source)} ${versionHtml(p.version)}</span>
        ${p.description ? `<span class="yui-row__sub yui-plg-sum" title="${esc(p.description)}">${esc(p.description)}</span>` : ""}
      </div>
      <button class="yui-switch" type="button" role="switch" aria-checked="${checked}" aria-label="${esc(t("plugins.switch_aria", { id: p.id }))}" data-act="toggle" data-id="${id}" data-fk="toggle:${id}"${busy || p.error ? " disabled" : ""}></button>
    </div>`;
  if (p.error) html += `<div>${errLineHtml(t("plugins.manifest_error"), p.error)}</div>`;
  else {
    if (awaitsReapproval && !ui.flow) {
      html += `<div class="yui-plg-reap" data-k="${id}:reapproval"><p>${t("plugins.reapprove_note")}</p><button class="yui-pill yui-pill--ok" type="button" data-act="reapprove" data-id="${id}" data-fk="reapprove:${id}"${disabledWhileUpdating}>${t("plugins.reapprove")}</button></div>`;
    }
    html += consentHtml(p, ui.flow);
    if (!ui.flow) {
      // Without consent nothing runs; the notice row says so.
      if (!awaitsReapproval) html += p.servers.map((sv) => serverHtml(p, sv, busy)).join("");
      html += hiddenHtml(p);
      if (p.tools.length || p.skills.length) {
        html += `<button class="yui-plg-disc" type="button" aria-expanded="${!!ui.toolsOpen}" data-act="tools" data-id="${id}" data-fk="tools:${id}">${ICON_CHEV}${countLabel(p)}</button>`;
        if (ui.toolsOpen) html += `<div data-k="${id}:tools">${itemsHtml(p)}</div>`;
      }
    }
  }
  if (ui.confirm) {
    const source = SOURCES[p.source];
    return `${html}<div class="yui-confirm" data-k="${id}:confirm" role="group">
      <span class="yui-confirm__q">${t(source.confirm, { id })}</span>
      <button class="yui-pill" type="button" data-act="rm-cancel" data-id="${id}" data-fk="rm-cancel:${id}">${t("plugins.cancel")}</button>
      <button class="yui-pill yui-pill--go" type="button" data-act="rm-go" data-id="${id}" data-fk="rm-go:${id}">${t(source.confirmGo)}</button></div></div>`;
  }
  const to = v.updateTo(p);
  let updateOrPath = "";
  if (busy)
    updateOrPath = `<span class="yui-plg-busy" role="status">${SPIN}${t("plugins.updating")}</span>`;
  else if (to)
    updateOrPath = `<button class="yui-link-btn yui-help-btn" type="button" data-act="update" data-id="${id}" data-fk="update:${id}">${t("plugins.update_to", { v: esc(to) })}</button>`;
  else if (!SOURCES[p.source].fromCatalog)
    updateOrPath = `<span class="yui-plg-path" title="${esc(p.path)}">${esc(p.path)}</span>`;
  html += `<div class="yui-row yui-row--action"><div class="yui-plg-acts">
      <button class="yui-link-btn" type="button" aria-expanded="${!!ui.logOpen}" data-act="log" data-id="${id}" data-fk="log:${id}">${ICON_CHEV}${t("plugins.log")}</button>${updateOrPath}
      <button class="yui-link-btn yui-plg-acts__end" type="button" data-act="remove" data-id="${id}" data-fk="remove:${id}"${disabledWhileUpdating}>${t(SOURCES[p.source].removeLabel)}</button></div></div>`;
  if (ui.error) {
    const retry = ui.error.retry
      ? `<button class="yui-link-btn" type="button" data-act="${ui.error.retry}" data-id="${id}" data-fk="again:${id}">${t("plugins.retry")}</button>`
      : "";
    html += `<div>${errLineHtml(t(ui.error.lead), ui.error.message, retry)}</div>`;
  }
  if (ui.logOpen) html += logHtml(p, ui);
  return `${html}</div>`;
}

export function installedHtml(v: InstalledView): string {
  const plugins = v.snapshot?.plugins;
  let aside = "";
  if (plugins?.length) {
    if (v.check === "busy")
      aside = `<span class="yui-plg-busy" role="status">${SPIN}${t("plugins.checking")}</span>`;
    else if (v.check)
      aside = `<span class="yui-plg-aside" role="status">${v.check.updates ? t("plugins.updates", { n: v.check.updates }) : t("plugins.up_to_date")}</span>`;
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
