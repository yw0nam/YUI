/** One switch row rendered from its descriptor: the label, the sub line, and the store-backed state. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../logger";
import { Switch } from "../../controls/switch";
import { t } from "../../i18n";
import type { SwitchRow } from "../switch-row";

// A rendered row always has a store; useSyncExternalStore subscribes here for the repaint.
const subscribeNever = () => () => {};

export function DescriptorRow({ row, log }: { row: SwitchRow; log: Logger }) {
  const enabled = useSyncExternalStore(row.subscribe ?? subscribeNever, row.getEnabled);
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">{t(row.labelKey)}</span>
        {row.subKey ? <span className="yui-row__sub">{t(row.subKey)}</span> : null}
      </div>
      <Switch
        className={row.selector.slice(1)}
        checked={enabled}
        label={t(row.ariaKey)}
        onCheckedChange={() => {
          if (!row.isAvailable) return;
          const next = !row.getEnabled();
          row.setEnabled(next);
          if (row.logKey) log.info(row.logKey, { enabled: next });
        }}
      />
    </div>
  );
}
