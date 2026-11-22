/** Idle motion cluster — per-variant on/off switches for the ambient idle pool on the Motion page. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import { enabledIdleVariants } from "../../../../settings/avatar/idle-motion-settings";
import { Switch } from "../../../controls/switch";
import { t } from "../../../i18n";
import type { MotionPorts } from "../motion-ports";

/** i18n key stem for a variant — "/motions/idle_01.vrma" → "idle_motion.idle_01". */
export function idleMotionKeyStem(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return `idle_motion.${file.replace(/\.vrma$/, "")}`;
}

export function IdleMotionSection({
  settings,
  getPool,
  log,
}: NonNullable<MotionPorts["idleMotion"]> & { log: Logger }) {
  const state = useSyncExternalStore(settings.subscribe, settings.current);
  // The catalog is read on each render and not subscribed: it loads once, before the next open.
  const pool = getPool();
  const catalog = pool ? (pool.variants?.length ? pool.variants : [pool.vrma_path]) : [];
  const enabled = pool ? enabledIdleVariants(pool, state) : [];

  return (
    <div className="yui-sec yui-idle-motion" hidden={catalog.length === 0}>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("idle_motion.section")}</h2>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: the row group the panel's shared row CSS styles */}
      <div className="yui-group yui-motions" role="group" aria-label={t("idle_motion.group_aria")}>
        {catalog.map((path) => {
          const stem = idleMotionKeyStem(path);
          const label = t(`${stem}.label`);
          // The baseline is the missing-clip fallback target, so it stays on and non-interactive.
          const isBaseline = path === pool?.vrma_path;
          return (
            <div className="yui-row" key={path}>
              <div className="yui-row__main">
                <span className="yui-row__label">{label}</span>
                <span className="yui-row__sub">
                  {isBaseline
                    ? `${t(`${stem}.sub`)} · ${t("idle_motion.always_on")}`
                    : t(`${stem}.sub`)}
                </span>
              </div>
              <Switch
                data-variant={path}
                checked={enabled.includes(path)}
                disabled={isBaseline}
                label={label}
                onCheckedChange={(next) => {
                  settings.setEnabled(path, next);
                  log.info("idle_motion_toggle", { variant: path, enabled: next });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
