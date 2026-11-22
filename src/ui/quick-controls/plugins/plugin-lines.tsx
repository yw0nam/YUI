/** The server line, the hidden-name note and the tool list a plugin's group and consent panel share. */

import { Fragment, type ReactNode } from "react";
import type { PluginHostPlugin, PluginHostServer } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import "../connection/endpoints-section.css";
import { type EnterRef, Spinner, useKeyedEnter, withSlot } from "./plugin-parts";

const DOT_CLASS: Record<PluginHostServer["status"], string> = {
  starting: "",
  running: "is-ok",
  failed: "is-bad",
  exited: "is-bad",
  stopped: "is-off",
};

export function ServerLine({
  server,
  busy,
  onRetry,
  animate,
}: {
  server: PluginHostServer;
  busy: boolean;
  onRetry(serverId: string): void;
  animate: EnterRef;
}) {
  const ref = useKeyedEnter(animate);
  const reason = <q>{server.reason ?? ""}</q>;
  const again = (key: string): ReactNode => (
    <button
      className="yui-link-btn"
      type="button"
      disabled={busy}
      onClick={() => onRetry(server.id)}
    >
      {t(key)}
    </button>
  );
  let state: ReactNode = "";
  let detail: ReactNode = null;
  let tail: ReactNode = null;
  if (server.status === "starting") state = t("plugins.starting");
  if (server.status === "running") state = <b>{t("plugins.sv_running")}</b>;
  if (server.status === "failed") {
    state = <b>{t("plugins.sv_failed")}</b>;
    detail = server.phase
      ? withSlot("plugins.sv_failed_detail", "reason", reason, {
          phase: t(`plugins.phase_${server.phase}`),
        })
      : reason;
    tail = again("plugins.retry");
  }
  if (server.status === "exited") {
    state = (
      <>
        <b>{t("plugins.sv_exited")}</b>
        {reason}
      </>
    );
    tail = again("plugins.restart");
  }
  if (server.status === "stopped") state = t("plugins.sv_stopped");
  return (
    <div className="yui-plg-sv" ref={ref}>
      {server.status === "starting" ? (
        <Spinner />
      ) : (
        <span
          className={`yui-chat-status__dot ${DOT_CLASS[server.status]}`}
          aria-hidden="true"
        ></span>
      )}
      <span className="yui-plg-sv__name">{server.name}</span>
      <span className="yui-plg-sv__state">{state}</span>
      {tail}
      {detail ? <span className="yui-plg-sv__detail">{detail}</span> : null}
    </div>
  );
}

/** One muted line per kind and holder; the plugin keeps running without these names. */
export function HiddenNote({ plugin, animate }: { plugin: PluginHostPlugin; animate: EnterRef }) {
  const ref = useKeyedEnter(animate);
  if (!plugin.hidden.length) return null;
  const groups = new Map<string, PluginHostPlugin["hidden"]>();
  for (const h of plugin.hidden) {
    const key = `${h.kind}|${h.holder}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  return (
    <div className="yui-plg-hid" ref={ref}>
      {[...groups.entries()].map(([group, hidden]) => {
        const { kind, holder } = hidden[0]!;
        const key = `plugins.hidden_${kind}_${holder === "builtin" ? "builtin" : "by"}`;
        const names = hidden.map((h, i) => (
          <Fragment key={h.name}>
            <span className="yui-plg-code">{h.name}</span>
            {i < hidden.length - 1 ? ", " : null}
          </Fragment>
        ));
        return <span key={group}>{withSlot(key, "names", names, { holder })}</span>;
      })}
    </div>
  );
}

/** The declared tools and skills; hidden names are said once, in the hidden note. */
export function ToolItems({ plugin }: { plugin: PluginHostPlugin }) {
  const li = (key: string, name: string, sum: string | null): ReactNode => (
    <li key={key}>
      <span className="yui-plg-tools__name">{name}</span>
      {sum ? <span className="yui-plg-tools__sum">{sum}</span> : null}
    </li>
  );
  return (
    <ul className="yui-plg-tools">
      {plugin.tools.map((tool) => li(`tool:${tool.name}`, tool.name, tool.description))}
      {plugin.skills.length ? (
        <li className="yui-plg-tools__kind">{t("plugins.skills_label")}</li>
      ) : null}
      {plugin.skills.map((skill) => li(`skill:${skill.name}`, skill.name, skill.description))}
    </ul>
  );
}
