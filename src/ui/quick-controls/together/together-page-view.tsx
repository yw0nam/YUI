/** The Together page: the switch rows and the chain cap, then the characters on the desktop. */

import { useMemo } from "react";
import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { SwitchRow } from "../switch-row";
import { DescriptorRow } from "../switches/descriptor-row";
import { ChainCapRow } from "./chain-cap/chain-cap-row";
import { CharactersSection, type WindowsPort } from "./characters/characters-section";

export function TogetherPageView({
  rows,
  rateLimitSettings,
  getRateLimitDefaults,
  registry,
  petWindows,
  boundId,
  log,
  revision,
}: {
  rows: readonly SwitchRow[];
  rateLimitSettings?: GuardrailsSettingsStore;
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
  registry?: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows?: WindowsPort;
  boundId?: string | null;
  log: Logger;
  /** Bumped by the open hook, so the row re-reads the bundled defaults. */
  revision: number;
}) {
  const rateLimitDefaults = useMemo(() => {
    // The open hook bumps the revision, so the row re-reads the bundled defaults.
    void revision;
    return getRateLimitDefaults?.();
  }, [getRateLimitDefaults, revision]);
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
              <ChainCapRow store={rateLimitSettings} defaults={rateLimitDefaults} />
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
