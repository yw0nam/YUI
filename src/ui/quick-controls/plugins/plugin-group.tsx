/** One installed plugin's group: its row, consent panel, disclosures, remove confirm and log. */

import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import { Switch } from "../../controls/switch";
import { t } from "../../i18n";
import { ConsentPanel, consentKey } from "./plugin-consent";
import { HiddenNote, ServerLine, ToolItems } from "./plugin-lines";
import {
  Badge,
  CHEV_ICON,
  ErrLine,
  KeyedBlock,
  SOURCES,
  Spinner,
  Version,
} from "./plugin-parts";
import type { PluginsState } from "./plugins-state";

function countLabel(plugin: PluginHostPlugin): string {
  return plugin.skills.length
    ? t("plugins.count_both", { n: plugin.tools.length, m: plugin.skills.length })
    : t("plugins.tools_n", { n: plugin.tools.length });
}

function LogBox({ plugin, state }: { plugin: PluginHostPlugin; state: PluginsState }) {
  const ui = state.uiOf(plugin.id);
  const log = ui.log;
  let body: ReactNode = null;
  let count = "";
  if (log && "error" in log) body = <ErrLine lead={t("plugins.err_log")} message={log.error} />;
  else if (log?.lines.length) {
    body = (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the log block keeps its markup, with no role added here
      <pre className="yui-plg-log" aria-label={t("plugins.log_aria", { id: plugin.id })}>
        {log.lines.join("\n")}
      </pre>
    );
    count = t("plugins.log_lines", { n: log.lines.length });
  } else if (log) body = <p className="yui-plg-log__foot">{t("plugins.log_empty")}</p>;
  return (
    <KeyedBlock className="yui-plg-logbox">
      {body}
      <span className="yui-plg-log__foot">
        {count}
        <button className="yui-link-btn" type="button" onClick={() => state.reveal(plugin.id)}>
          {t("plugins.log_folder")}
        </button>
      </span>
      {ui.revealError ? (
        <ErrLine lead={t("plugins.err_reveal")} message={ui.revealError} />
      ) : null}
    </KeyedBlock>
  );
}

function RemoveConfirm({ plugin, state }: { plugin: PluginHostPlugin; state: PluginsState }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, []);
  const source = SOURCES[plugin.source];
  return (
    <KeyedBlock className="yui-confirm" role="group">
      <span className="yui-confirm__q">{t(source.confirm, { id: plugin.id })}</span>
      <button
        ref={cancel}
        className="yui-pill"
        type="button"
        onClick={() => state.rmCancel(plugin.id)}
      >
        {t("plugins.cancel")}
      </button>
      <button className="yui-pill yui-pill--go" type="button" onClick={() => state.rmGo(plugin.id)}>
        {t(source.confirmGo)}
      </button>
    </KeyedBlock>
  );
}

export function PluginGroup({
  plugin,
  state,
}: {
  plugin: PluginHostPlugin;
  state: PluginsState;
}) {
  const ui = state.uiOf(plugin.id);
  const flow = ui.flow;
  const busy = !!ui.updating;
  const awaitsReapproval = plugin.enabled && !plugin.consented;
  const to = state.catalog.updateTo(plugin);
  const updateOrPath: ReactNode = busy ? (
    <span className="yui-plg-busy" role="status">
      <Spinner />
      {t("plugins.updating")}
    </span>
  ) : to ? (
    <button
      className="yui-link-btn yui-help-btn"
      type="button"
      onClick={() => state.update(plugin.id)}
    >
      {t("plugins.update_to", { v: to })}
    </button>
  ) : !SOURCES[plugin.source].fromCatalog ? (
    <span className="yui-plg-path" title={plugin.path}>
      {plugin.path}
    </span>
  ) : null;

  return (
    <KeyedBlock className="yui-group" data-pid={plugin.id}>
      <div className="yui-row">
        <div className="yui-row__main">
          <span className="yui-row__label">
            {plugin.id} <Badge source={plugin.source} /> <Version version={plugin.version} />
          </span>
          {plugin.description ? (
            <span className="yui-row__sub yui-plg-sum" title={plugin.description}>
              {plugin.description}
            </span>
          ) : null}
        </div>
        <Switch
          checked={plugin.enabled && plugin.consented}
          disabled={busy || !!plugin.error}
          label={t("plugins.switch_aria", { id: plugin.id })}
          onCheckedChange={() => state.toggle(plugin.id)}
        />
      </div>
      {plugin.error ? (
        <div>
          <ErrLine lead={t("plugins.manifest_error")} message={plugin.error} />
        </div>
      ) : (
        <>
          {awaitsReapproval && !flow ? (
            <KeyedBlock className="yui-plg-reap">
              <p>{t("plugins.reapprove_note")}</p>
              <button
                className="yui-pill yui-pill--ok"
                type="button"
                disabled={busy}
                onClick={() => state.reapprove(plugin.id)}
              >
                {t("plugins.reapprove")}
              </button>
            </KeyedBlock>
          ) : null}
          {flow ? (
            <ConsentPanel
              key={consentKey(plugin, flow)}
              plugin={plugin}
              flow={flow}
              state={state}
            />
          ) : null}
          {!flow ? (
            <>
              {!awaitsReapproval
                ? plugin.servers.map((server) => (
                    <ServerLine
                      key={`${server.id}:${server.status}`}
                      server={server}
                      busy={busy}
                      onRetry={(serverId) => state.retry(plugin.id, serverId)}
                    />
                  ))
                : null}
              {plugin.hidden.length ? <HiddenNote plugin={plugin} /> : null}
              {plugin.tools.length || plugin.skills.length ? (
                <>
                  <button
                    className="yui-plg-disc"
                    type="button"
                    aria-expanded={!!ui.toolsOpen}
                    onClick={() => state.tools(plugin.id)}
                  >
                    {CHEV_ICON}
                    {countLabel(plugin)}
                  </button>
                  {ui.toolsOpen ? (
                    <KeyedBlock>
                      <ToolItems plugin={plugin} />
                    </KeyedBlock>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {ui.confirm ? (
        <RemoveConfirm plugin={plugin} state={state} />
      ) : (
        <>
          <div className="yui-row yui-row--action">
            <div className="yui-plg-acts">
              <button
                className="yui-link-btn"
                type="button"
                aria-expanded={!!ui.logOpen}
                onClick={() => state.log(plugin.id)}
              >
                {CHEV_ICON}
                {t("plugins.log")}
              </button>
              {updateOrPath}
              <button
                className="yui-link-btn yui-plg-acts__end"
                type="button"
                disabled={busy}
                onClick={() => state.remove(plugin.id)}
              >
                {t(SOURCES[plugin.source].removeLabel)}
              </button>
            </div>
          </div>
          {ui.error ? (
            <div>
              <ErrLine
                lead={t(ui.error.lead)}
                message={ui.error.message}
                tail={
                  ui.error.retry ? (
                    <button
                      className="yui-link-btn"
                      type="button"
                      onClick={() => state.update(plugin.id)}
                    >
                      {t("plugins.retry")}
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
          {ui.logOpen ? <LogBox plugin={plugin} state={state} /> : null}
        </>
      )}
    </KeyedBlock>
  );
}