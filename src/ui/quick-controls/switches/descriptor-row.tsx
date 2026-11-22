/** One switch row rendered from its descriptor: the label, the sub line, and the store-backed state. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../logger";
import { Switch } from "../../controls/switch";
import { t } from "../../i18n";
import type { SwitchRow } from "../switch-row";

// A row with no store or no lock has nothing to follow.
const subscribeNever = () => () => {};
const never = () => false;

export function DescriptorRow({ row, log }: { row: SwitchRow; log: Logger }) {
  // An unavailable row has no store to read, so it shows its initial state.
  const enabled = useSyncExternalStore(
    row.subscribe ?? subscribeNever,
    row.isAvailable ? row.getEnabled : () => row.initialEnabled,
  );
  const { lock } = row;
  const locked = useSyncExternalStore(lock?.subscribe ?? subscribeNever, lock?.get ?? never);
  const sub = locked && lock ? t(lock.reasonKey) : row.subKey ? t(row.subKey) : null;
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        {row.labelIcon ? (
          <span
            className="yui-row__label"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph beside the label
            dangerouslySetInnerHTML={{ __html: `${row.labelIcon}${t(row.labelKey)}` }}
          />
        ) : (
          <span className="yui-row__label">{t(row.labelKey)}</span>
        )}
        {sub ? <span className="yui-row__sub">{sub}</span> : null}
      </div>
      <Switch
        className={row.selector.slice(1)}
        // The store keeps its value while locked, so unlocking shows it again.
        checked={!locked && enabled}
        disabled={locked}
        label={t(row.ariaKey)}
        onCheckedChange={() => {
          if (!row.isAvailable || locked) return;
          const next = !row.getEnabled();
          row.setEnabled(next);
          if (row.logKey) log.info(row.logKey, { enabled: next });
        }}
      />
    </div>
  );
}
