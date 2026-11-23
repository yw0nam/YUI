/** Advanced, folded at the foot of the Proactive page: the wait and presence, then the hourly limits and their note. */

import { useSyncExternalStore } from "react";
import {
  type GuardrailsSettingsStore,
  RATE_LIMIT_MAX,
  type RateLimitDefaults,
} from "../../../../settings/backend/guardrails-settings";
import type { ClampedIntSettingsStore } from "../../../../settings/persisted-store";
import { t } from "../../../i18n";
import { DISCLOSURE_CHEV_SVG, PROACTIVE_CAP_FIELDS } from "../../constants";
import { NumberRow } from "../number-row";

function GapRow({ store }: { store: ClampedIntSettingsStore }) {
  const ms = useSyncExternalStore(store.subscribe, () => store.get().value);
  return (
    <NumberRow
      id="yui-pacer-gap"
      label={t("reactions.pacer_gap_label")}
      sub={t("reactions.pacer_gap_sub")}
      hint={t("reactions.pacer_gap_hint")}
      min={0}
      max={180}
      unit={t("reactions.minutes_suffix")}
      value={String(ms / 60_000)}
      commit={(raw) => store.set(Math.round(Number(raw)) * 60_000)}
    />
  );
}

function PresenceRow({ store }: { store: ClampedIntSettingsStore }) {
  const ms = useSyncExternalStore(store.subscribe, () => store.get().value);
  return (
    <NumberRow
      id="yui-presence"
      label={t("reactions.presence_label")}
      sub={t("reactions.presence_sub")}
      hint={t("reactions.restart_hint")}
      min={10}
      max={3600}
      unit={t("reactions.seconds_suffix")}
      value={String(ms / 1000)}
      commit={(raw) => store.set(Math.round(Number(raw)) * 1000)}
    />
  );
}

/** Each cap shows its override, else the bundled default; an emptied field clears the override. */
function CapRows({
  store,
  defaults,
}: {
  store: GuardrailsSettingsStore;
  defaults: RateLimitDefaults | undefined;
}) {
  const overrides = useSyncExternalStore(store.subscribe, store.current);
  return (
    <div className="yui-group">
      {PROACTIVE_CAP_FIELDS.map((field) => {
        const effective =
          overrides[field.key] > 0 ? overrides[field.key] : (defaults?.[field.key] ?? 0);
        return (
          <NumberRow
            key={field.key}
            id={field.id}
            label={t(field.labelKey)}
            sub={t(field.subKey)}
            min={1}
            max={RATE_LIMIT_MAX}
            value={effective > 0 ? String(effective) : ""}
            commit={(raw) => store.set({ [field.key]: Math.round(Number(raw)) })}
          />
        );
      })}
    </div>
  );
}

export function AdvancedSection({
  pacerGapSettings,
  presenceSettings,
  rateLimitSettings,
  rateLimitDefaults,
}: {
  pacerGapSettings?: ClampedIntSettingsStore;
  presenceSettings?: ClampedIntSettingsStore;
  rateLimitSettings?: GuardrailsSettingsStore;
  rateLimitDefaults: RateLimitDefaults | undefined;
}) {
  return (
    <div className="yui-sec">
      <details className="yui-more">
        <summary
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph beside the label
          dangerouslySetInnerHTML={{ __html: `${DISCLOSURE_CHEV_SVG}${t("reactions.advanced")}` }}
        />
        {pacerGapSettings || presenceSettings ? (
          <div className="yui-group">
            {pacerGapSettings ? <GapRow store={pacerGapSettings} /> : null}
            {presenceSettings ? <PresenceRow store={presenceSettings} /> : null}
          </div>
        ) : null}
        {rateLimitSettings ? (
          <>
            <CapRows store={rateLimitSettings} defaults={rateLimitDefaults} />
            <p className="yui-sec__foot">{t("reactions.rate_hint")}</p>
          </>
        ) : null}
      </details>
    </div>
  );
}
