/** The consent panel: step 1's facts, then the starting, started or failed step 2. */

import type { PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import { HiddenNote, ServerLine, ToolItems } from "./plugin-lines";
import { Badge, KeyedBlock, SHIELD_ICON, SOURCES, Spinner } from "./plugin-parts";
import type { PluginUi, PluginsState } from "./plugins-state";

/** The panel a flow shows once enable has resolved: starting, failed, or step 2. */
function stepTwoPanel(p: PluginHostPlugin): "starting" | "failed" | "started" {
  if (p.servers.some((sv) => sv.status === "starting")) return "starting";
  if (p.servers.some((sv) => sv.status === "failed" || sv.status === "exited")) return "failed";
  return "started";
}

/** The block a state keys its panel by, so a changed step remounts and fades in. */
export function consentKey(p: PluginHostPlugin, flow: NonNullable<PluginUi["flow"]>): string {
  if (flow === "step1") return `${p.id}:consent`;
  return `${p.id}:${flow === "enabling" ? "starting" : stepTwoPanel(p)}`;
}

function Step({ n }: { n: 1 | 2 }) {
  return (
    <p className="yui-plg-consent__step">
      <i className="on" />
      <i className={n === 2 ? "on" : undefined} />
      {t("plugins.step", { n })}
    </p>
  );
}

function Foot({
  id,
  state,
  note,
  okKey,
}: {
  id: string;
  state: PluginsState;
  note: string;
  okKey: string;
}) {
  return (
    <div className="yui-plg-btns">
      <span className="yui-plg-btns__note">{t(note)}</span>
      <button className="yui-pill" type="button" onClick={() => state.off(id)}>
        {t("plugins.turn_off")}
      </button>
      <button className="yui-pill yui-pill--ok" type="button" onClick={() => state.done(id)}>
        {t(okKey)}
      </button>
    </div>
  );
}

function StepOne({ plugin, state }: { plugin: PluginHostPlugin; state: PluginsState }) {
  const many = plugin.servers.length > 1;
  const { warning } = SOURCES[plugin.source];
  const question =
    plugin.enabled && !plugin.consented
      ? t("plugins.consent_q_reapprove")
      : t("plugins.consent_q", { id: plugin.id });
  return (
    <KeyedBlock
      className="yui-plg-consent"
      role="group"
      aria-label={t("plugins.consent_aria", { id: plugin.id })}
    >
      <Step n={1} />
      <p className="yui-plg-consent__q">{question}</p>
      <dl className="yui-plg-facts">
        <dt>{t("plugins.fact_source")}</dt>
        <dd>
          <Badge source={plugin.source} /> <small>{t(SOURCES[plugin.source].review)}</small>
          <br />
          <span>{plugin.path}</span>
        </dd>
        <dt>{t("plugins.fact_version")}</dt>
        <dd>
          {plugin.version ? (
            t("plugins.version", { version: plugin.version })
          ) : (
            <small>{t("plugins.no_version")}</small>
          )}
        </dd>
        <dt>{t("plugins.fact_command")}</dt>
        <dd>
          {plugin.servers.length ? (
            plugin.servers.map((server) => (
              <code className="yui-plg-cmd" key={server.id}>
                {many ? (
                  <>
                    <b>{server.name}</b>{" "}
                  </>
                ) : null}
                {server.command}
              </code>
            ))
          ) : (
            <small>{t("plugins.no_servers")}</small>
          )}
        </dd>
      </dl>
      <p className="yui-plg-warn">
        {SHIELD_ICON}
        <span>{t("plugins.shield")}</span>
      </p>
      {warning ? (
        <p className={warning.strong ? "yui-plg-warn yui-plg-warn--strong" : "yui-plg-warn"}>
          {warning.icon}
          <span>{t(warning.key)}</span>
        </p>
      ) : null}
      <div className="yui-plg-btns">
        <button className="yui-pill" type="button" onClick={() => state.cancel(plugin.id)}>
          {t("plugins.cancel")}
        </button>
        <button className="yui-pill yui-pill--ok" type="button" onClick={() => state.allow(plugin.id)}>
          {t("plugins.allow")}
        </button>
      </div>
    </KeyedBlock>
  );
}

function Starting() {
  return (
    <KeyedBlock className="yui-plg-consent">
      <Step n={2} />
      <div className="yui-plg-wait" role="status">
        <Spinner />
        {t("plugins.starting")}
      </div>
    </KeyedBlock>
  );
}

function Started({ plugin, state }: { plugin: PluginHostPlugin; state: PluginsState }) {
  const any = plugin.tools.length || plugin.skills.length;
  const question = !any
    ? t("plugins.started_none")
    : plugin.skills.length
      ? t("plugins.started_both", { n: plugin.tools.length, m: plugin.skills.length })
      : t("plugins.started_tools", { n: plugin.tools.length });
  return (
    <KeyedBlock
      className="yui-plg-consent"
      role="group"
      aria-label={t("plugins.step2_aria", { id: plugin.id })}
    >
      <Step n={2} />
      <p className="yui-plg-consent__q">{question}</p>
      {any ? <ToolItems plugin={plugin} /> : null}
      {plugin.hidden.length ? <HiddenNote plugin={plugin} /> : null}
      <Foot id={plugin.id} state={state} note="plugins.backend_decides" okKey="plugins.ok" />
    </KeyedBlock>
  );
}

function Failed({ plugin, state }: { plugin: PluginHostPlugin; state: PluginsState }) {
  return (
    <KeyedBlock
      className="yui-plg-consent"
      role="group"
      aria-label={t("plugins.failed_aria", { id: plugin.id })}
    >
      <Step n={2} />
      <p className="yui-plg-consent__q">{t("plugins.failed_q")}</p>
      <div className="yui-group">
        {plugin.servers.map((server) => (
          <ServerLine
            key={`${server.id}:${server.status}`}
            server={server}
            busy={false}
            onRetry={(serverId) => state.retry(plugin.id, serverId)}
          />
        ))}
      </div>
      <Foot id={plugin.id} state={state} note="plugins.keep_on_note" okKey="plugins.keep_on" />
    </KeyedBlock>
  );
}

export function ConsentPanel({
  plugin,
  flow,
  state,
}: {
  plugin: PluginHostPlugin;
  flow: NonNullable<PluginUi["flow"]>;
  state: PluginsState;
}) {
  if (flow === "step1") return <StepOne plugin={plugin} state={state} />;
  const panel = flow === "enabling" ? "starting" : stepTwoPanel(plugin);
  if (panel === "starting") return <Starting />;
  if (panel === "started") return <Started plugin={plugin} state={state} />;
  return <Failed plugin={plugin} state={state} />;
}