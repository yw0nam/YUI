/** Her day: the edited character's pace runs over 24 hours with the greetings and now, then the check-ins after quiet. */

import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import type { BasePace } from "../../../../settings/active-hours/base-pace-settings";
import { spansInUse } from "../../../../settings/active-hours/card-active-hours";
import { paceAt, toMinutes } from "../../../../settings/active-hours/spans";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import type { ProactiveSettings } from "../../../../settings/cues/proactive-settings";
import type { ScheduleSettings } from "../../../../settings/cues/schedule-settings";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import { getLocale, t } from "../../../i18n";
import { avatarEl } from "../../../unified/avatar";
import { presetEntry } from "../../persona/card/card-entry";
import { checkinLadder, paceRuns } from "./day-geometry";
import "./day-strip.css";

const NO_SUBSCRIBE = () => () => {};
const DAY = 1440;
const DAY_AXIS = [0, 6, 12, 18, 24];
const LADDER_AXIS = [0, 0.25, 0.5, 0.75, 1];

/** A position (and width) as fractions of the lane, written to the CSSOM as custom properties. */
const at = (x: number, span?: number) =>
  ({ "--yui-at": x, ...(span === undefined ? {} : { "--yui-span": span }) }) as CSSProperties;

const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A label pinned at `x`; the first and last keep inside the lane. */
function At({ x, edge, children }: { x: number; edge?: "start" | "end"; children: string }) {
  return (
    <span className={edge ? `yui-day__at yui-day__at--${edge}` : "yui-day__at"} style={at(x)}>
      {children}
    </span>
  );
}

/** The edited character's face, mounted as a vanilla element. */
function Face({ entry, x }: { entry: PresetEntry; x: number }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => host.current?.replaceChildren(avatarEl(entry, 24)), [entry]);
  return <span ref={host} className="yui-day__face" style={at(x)} aria-hidden="true" />;
}

/** The local minute of the day, read on each render and redrawn every minute. */
function useNowMinute(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function DayStrip({
  pace,
  activeHoursSettings,
  agentSettings,
  getPersona,
  proactive,
  schedule,
}: {
  pace: BasePace;
  activeHoursSettings?: Pick<ActiveHoursSettingsStore, "current" | "subscribe">;
  agentSettings: Pick<ReturnType<typeof createAgentSettings>, "current" | "subscribe">;
  getPersona?: () => PersonaConfig | undefined;
  proactive: ProactiveSettings;
  schedule: ScheduleSettings;
}) {
  const nameId = useId();
  const edited = useSyncExternalStore(activeHoursSettings?.subscribe ?? NO_SUBSCRIBE, () =>
    activeHoursSettings ? activeHoursSettings.current().spans : null,
  );
  const userCard = useSyncExternalStore(
    agentSettings.subscribe,
    () => agentSettings.current().card,
  );
  const spans = spansInUse(edited, userCard ?? getPersona?.()?.cards[getLocale()]);
  const now = useNowMinute();
  const entry = presetEntry();

  // An off span holds the schedule, so a greeting there never comes.
  const greetings = schedule.enabled
    ? schedule.entries.filter((e) => e.enabled && paceAt(spans, toMinutes(e.time)) !== "off")
    : [];
  const ladder = checkinLadder(
    proactive.enabled ? proactive.entries.filter((e) => e.enabled).map((e) => e.idle_min) : [],
    pace,
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a row group the panel's shared group CSS styles
    <div className="yui-group yui-day" role="group" aria-labelledby={nameId}>
      <p className="yui-day__name" id={nameId}>
        {t("day_strip.label", { name: entry.name })}
      </p>
      <div className="yui-day__marks">
        <Face entry={entry} x={now / DAY} />
        {greetings.map((g) => (
          <At key={g.id} x={toMinutes(g.time) / DAY}>
            {g.time}
          </At>
        ))}
        {greetings.map((g) => (
          <span key={g.id} className="yui-day__greeting" style={at(toMinutes(g.time) / DAY)} />
        ))}
      </div>
      <div className="yui-day__track">
        {paceRuns(spans).map((run) => (
          <span
            key={run.start}
            className="yui-day__run"
            data-pace={run.pace}
            style={at(run.start / DAY, (run.end - run.start) / DAY)}
          >
            {t(`active_hours.pace_${run.pace}`)}
          </span>
        ))}
        <span className="yui-day__now" style={at(now / DAY)} />
      </div>
      <div className="yui-day__axis">
        {DAY_AXIS.map((h, i) => (
          <At
            key={h}
            x={h / 24}
            edge={i === 0 ? "start" : i === DAY_AXIS.length - 1 ? "end" : undefined}
          >
            {`${String(h).padStart(2, "0")}:00`}
          </At>
        ))}
      </div>
      <div className="yui-day__head">
        <span>{t("day_strip.checkins")}</span>
        <span className="yui-day__vals">
          {ladder.marks.length > 0
            ? t("cue.minutes_summary", { list: ladder.marks.map(num).join(" · ") })
            : t("fold.off")}
        </span>
      </div>
      <div className="yui-day__ladder">
        {ladder.marks.map((min, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two check-ins may share a minute
          <span key={i} className="yui-day__checkin" style={at(min / ladder.end)} />
        ))}
      </div>
      <div className="yui-day__axis">
        {LADDER_AXIS.map((f, i) => (
          <At
            key={f}
            x={f}
            edge={i === 0 ? "start" : i === LADDER_AXIS.length - 1 ? "end" : undefined}
          >
            {f === 1 ? t("cue.minutes_summary", { list: ladder.end }) : num(f * ladder.end)}
          </At>
        ))}
      </div>
    </div>
  );
}
