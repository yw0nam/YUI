/** The Installed plugins section: the host snapshot's plugins, its foot, and a failed delete. */

import type { KeyboardEvent, ReactNode } from "react";
import { t } from "../../i18n";
import { PluginGroup } from "./plugin-group";
import { ErrLine, Spinner } from "./plugin-parts";
import type { PluginsState } from "./plugins-state";

export function InstalledSection({
  state,
  onKeyDown,
}: {
  state: PluginsState;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}) {
  const plugins = state.snapshot()?.plugins;
  const check = state.catalog.checkState();
  let aside: ReactNode = null;
  if (plugins?.length) {
    if (check === "busy")
      aside = (
        <span className="yui-plg-busy" role="status">
          <Spinner />
          {t("plugins.checking")}
        </span>
      );
    else if (check)
      aside = (
        <span className="yui-plg-aside" role="status">
          {check.updates ? t("plugins.updates", { n: check.updates }) : t("plugins.up_to_date")}
        </span>
      );
    else
      aside = (
        <button className="yui-link-btn" type="button" onClick={() => state.check()}>
          {t("plugins.check")}
        </button>
      );
  }
  let body: ReactNode;
  if (!plugins)
    body = (
      <div className="yui-group">
        <div className="yui-plg-state" role="status">
          <Spinner />
          {t("plugins.loading")}
        </div>
      </div>
    );
  else if (!plugins.length)
    body = (
      <div className="yui-group">
        <div className="yui-plg-state">{t("plugins.empty")}</div>
      </div>
    );
  else
    body = plugins.map((plugin) => <PluginGroup key={plugin.id} plugin={plugin} state={state} />);
  // The snapshot lists only running servers' tools, hidden names already left out.
  const n = plugins?.reduce((sum, plugin) => sum + plugin.tools.length, 0) ?? 0;
  const removal = state.removal.error;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape inside the page closes its own panels
    <section className="yui-sec" onKeyDown={onKeyDown}>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("plugins.installed_title")}</h2>
        {aside}
      </div>
      {body}
      {plugins?.length ? <p className="yui-sec__foot">{t("plugins.foot", { n })}</p> : null}
      {removal ? (
        <div>
          <ErrLine lead={t(removal.lead)} message={removal.message} />
        </div>
      ) : null}
    </section>
  );
}
