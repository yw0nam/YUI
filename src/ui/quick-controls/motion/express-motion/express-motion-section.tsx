/** Express motion cluster — a category accordion curating the agent-selectable motion vocabulary. */
import "./express-motion-section.css";
import { useState, useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import { enabledExpressMotions } from "../../../../settings/avatar/express-motion-settings";
import { Checkbox } from "../../../controls/checkbox";
import { Switch } from "../../../controls/switch";
import { t } from "../../../i18n";
import { HIST_CHEVRON_SVG } from "../../constants";
import type { MotionPorts } from "../motion-ports";

/** Static display grouping. Ids the table does not name fall into the trailing `other` group. */
export const EXPRESS_MOTION_GROUPS: ReadonlyArray<{ id: string; ids: readonly string[] }> = [
  { id: "reaction", ids: ["happy", "laugh", "embarrassed", "sheepish", "calm", "sulk"] },
  { id: "action", ids: ["idle_lively", "dance"] },
];

const OTHER_GROUP = "other";

interface ExpressMotionGroup {
  id: string;
  ids: string[];
}

/** Vocabulary → display groups, table order first, then whatever the table does not name. */
export function groupExpressMotions(vocabulary: readonly string[]): ExpressMotionGroup[] {
  const groups = EXPRESS_MOTION_GROUPS.map((group) => ({
    id: group.id,
    ids: group.ids.filter((id) => vocabulary.includes(id)),
  })).filter((group) => group.ids.length > 0);
  const named = new Set(EXPRESS_MOTION_GROUPS.flatMap((group) => group.ids));
  const rest = vocabulary.filter((id) => !named.has(id));
  return rest.length > 0 ? [...groups, { id: OTHER_GROUP, ids: rest }] : groups;
}

type ExpressMotionPort = NonNullable<MotionPorts["expressMotion"]>;

function MotionRow({
  id,
  enabled,
  settings,
  log,
}: {
  id: string;
  enabled: boolean;
  settings: ExpressMotionPort["settings"];
  log: Logger;
}) {
  const label = t(`express_motion.${id}.label`);
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">{label}</span>
        <span className="yui-row__sub">{t(`express_motion.${id}.sub`)}</span>
      </div>
      <Switch
        data-motion={id}
        checked={enabled}
        label={label}
        onCheckedChange={(next) => {
          settings.setEnabled(id, next);
          log.info("express_motion_toggle", { motion: id, enabled: next });
        }}
      />
    </div>
  );
}

function MotionGroup({
  group,
  enabled,
  open,
  onToggle,
  settings,
  log,
}: {
  group: ExpressMotionGroup;
  enabled: readonly string[];
  open: boolean;
  onToggle(): void;
  settings: ExpressMotionPort["settings"];
  log: Logger;
}) {
  const name = t(`express_motion.group.${group.id}`);
  const rowsId = `yui-express-rows-${group.id}`;
  const on = group.ids.filter((id) => enabled.includes(id)).length;
  const all = on === group.ids.length;
  return (
    <div className={open ? "yui-express__group is-open" : "yui-express__group"}>
      <div className="yui-express__head">
        <button
          type="button"
          className="yui-express__toggle"
          data-group={group.id}
          aria-expanded={open}
          aria-controls={rowsId}
          onClick={onToggle}
        >
          <span
            className={open ? "yui-express__chev is-open" : "yui-express__chev"}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a static SVG constant
            dangerouslySetInnerHTML={{ __html: HIST_CHEVRON_SVG }}
          />
          <span className="yui-express__name">{name}</span>
          <span className="yui-express__count">
            {t("express_motion.count", { on, total: group.ids.length })}
          </span>
        </button>
        {/* A checkbox, not a switch: only checkbox supports the mixed state a partly-on group is in. */}
        <Checkbox
          className="yui-express__master"
          checked={all}
          indeterminate={on > 0 && !all}
          label={t("express_motion.master_aria", { group: name })}
          onCheckedChange={() => {
            // Mixed or off turns the group on; only a fully-on group turns off.
            const next = !all;
            settings.setAllEnabled(group.ids, next);
            log.info("express_motion_group_toggle", { group: group.id, enabled: next });
          }}
        />
      </div>
      {open ? (
        // biome-ignore lint/a11y/useSemanticElements: the row group the panel's shared row CSS styles
        <div className="yui-express__rows" id={rowsId} role="group" aria-label={name}>
          {group.ids.map((id) => (
            <MotionRow
              key={id}
              id={id}
              enabled={enabled.includes(id)}
              settings={settings}
              log={log}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExpressMotionSection({
  settings,
  getVocabulary,
  log,
}: ExpressMotionPort & { log: Logger }) {
  const state = useSyncExternalStore(settings.subscribe, settings.current);
  // Open groups last as long as the page; nothing persists them.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // The vocabulary is read on each render and not subscribed: it loads once, before the next open.
  const vocabulary = getVocabulary();
  const groups = groupExpressMotions(vocabulary);
  const enabled = enabledExpressMotions(vocabulary, state);

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div className="yui-sec yui-express-motion" hidden={vocabulary.length === 0}>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("express_motion.section")}</h2>
      </div>
      <p className="yui-sec__note">{t("express_motion.sub")}</p>
      {/* biome-ignore lint/a11y/useSemanticElements: the row group the panel's shared row CSS styles */}
      <div
        className="yui-group yui-express"
        role="group"
        aria-label={t("express_motion.group_aria")}
      >
        {groups.map((group) => (
          <MotionGroup
            key={group.id}
            group={group}
            enabled={enabled}
            open={expanded.has(group.id)}
            onToggle={() => toggle(group.id)}
            settings={settings}
            log={log}
          />
        ))}
      </div>
    </div>
  );
}
