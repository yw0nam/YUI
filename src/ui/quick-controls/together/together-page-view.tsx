/** The Together page: the switch rows and the chain cap, then the characters on the desktop. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PetWindows } from "../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { Switch } from "../../controls/switch";
import { t } from "../../i18n";
import type { SwitchRow } from "../switch-row";
import { type ChainCapReflect, ChainCapRow } from "./chain-cap/chain-cap-row";
import { CharactersSection } from "./characters/characters-section";

type WindowsPort = Pick<PetWindows, "get" | "open" | "close" | "subscribe" | "invalidate">;

// A rendered row always has a store; the follower keeps the repaint on a store change.
const subscribeNever = () => () => {};

/** One switch row rendered from its descriptor: the label, the sub line, and the store-backed state. */
function DescriptorRow({ row, log }: { row: SwitchRow; log: Logger }) {
  const enabled = useSyncExternalStore(row.subscribe ?? subscribeNever, row.getEnabled);
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">
          {row.labelIcon ? (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a descriptor's constant glyph shared with the template
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: row.labelIcon }} />
          ) : null}
          {t(row.labelKey)}
        </span>
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

export function TogetherPageView({
  rows,
  rateLimitSettings,
  getRateLimitDefaults,
  registry,
  petWindows,
  boundId,
  log,
  capReflect,
}: {
  rows: readonly SwitchRow[];
  rateLimitSettings?: GuardrailsSettingsStore;
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
  registry?: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows?: WindowsPort;
  boundId?: string | null;
  log: Logger;
  capReflect: ChainCapReflect;
}) {
  const visible = rows.filter((row) => row.isVisible);
  return (
    <>
      {visible.length > 0 || rateLimitSettings ? (
        <div className="yui-sec">
          <div className="yui-group">
            {visible.map((row) => (
              <DescriptorRow key={row.selector} row={row} log={log} />
            ))}
            {rateLimitSettings ? (
              <ChainCapRow
                store={rateLimitSettings}
                getDefaults={getRateLimitDefaults}
                reflectRef={capReflect}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {registry && petWindows ? (
        <CharactersSection
          registry={registry}
          petWindows={petWindows}
          boundId={boundId ?? null}
          log={log}
        />
      ) : null}
    </>
  );
}
