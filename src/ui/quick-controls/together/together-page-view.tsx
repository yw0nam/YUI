/** The Together page: the switch rows and the chain cap, then the characters on the desktop. */

import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { SwitchRow } from "../switch-row";
import { DescriptorRow } from "../switches/descriptor-row";
import { type ChainCapReflect, ChainCapRow } from "./chain-cap/chain-cap-row";
import { CharactersSection, type WindowsPort } from "./characters/characters-section";

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
