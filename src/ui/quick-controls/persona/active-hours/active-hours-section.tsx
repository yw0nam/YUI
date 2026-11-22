/** The Active hours editor: the span rows, the add action, and Reset to default; any edit writes the whole list. */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { Logger } from "../../../../logger";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import { spansInUse } from "../../../../settings/active-hours/card-active-hours";
import { type Pace, type Span, TIME_RE } from "../../../../settings/active-hours/spans";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { getLocale, t } from "../../../i18n";
import { PLUS_SVG } from "../../constants";
import { SpanRow } from "./span-row";
import "./active-hours-section.css";

export function ActiveHoursSection({
  store,
  agentSettings,
  getPersona,
  log,
}: {
  store: Pick<ActiveHoursSettingsStore, "current" | "subscribe" | "setSpans" | "reset">;
  agentSettings: Pick<ReturnType<typeof createAgentSettings>, "current" | "subscribe">;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}) {
  const edited = useSyncExternalStore(store.subscribe, () => store.current().spans);
  const userCard = useSyncExternalStore(
    agentSettings.subscribe,
    () => agentSettings.current().card,
  );
  const spans = spansInUse(edited, userCard ?? getPersona?.()?.cards[getLocale()]);
  const sec = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // The whole row list is one edit: read every row, write one setSpans.
  const commit = useCallback(
    (skip?: HTMLElement): void => {
      const rows = [
        ...(list.current?.querySelectorAll<HTMLElement>(".yui-hours__span") ?? []),
      ].filter((row) => row !== skip);
      const next: Span[] = [];
      for (const row of rows) {
        const [start, end] = row.querySelectorAll<HTMLInputElement>(".yui-time-input");
        if (!TIME_RE.test(start.value) || !TIME_RE.test(end.value)) return;
        next.push({
          start: start.value,
          end: end.value,
          pace: row.querySelector<HTMLSelectElement>(".yui-hours__pace")!.value as Pace,
        });
      }
      store.setSpans(next);
    },
    [store],
  );

  const onChange = useCallback(
    (e: Event): void => {
      if ((e.target as HTMLElement).matches(".yui-time-input, .yui-hours__pace")) commit();
    },
    [commit],
  );

  useEffect(() => {
    const el = sec.current;
    if (!el) return;
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onChange]);

  return (
    <div className="yui-sec yui-hours" ref={sec}>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("active_hours.label")}</h2>
        <button
          className="yui-reset"
          type="button"
          hidden={edited === null}
          onClick={() => {
            store.reset();
            log.info("active_hours_reset");
          }}
        >
          {t("card.reset")}
        </button>
      </div>
      <p className="yui-sec__note">{t("active_hours.note")}</p>
      <div className="yui-group">
        <div className="yui-cue-list" ref={list}>
          {spans.map((span, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is its position in the list
            <SpanRow key={i} span={span} onRemove={(row) => commit(row)} />
          ))}
        </div>
        <div className="yui-row yui-row--action">
          <button
            className="yui-add-btn"
            type="button"
            onClick={() =>
              store.setSpans([...spans, { start: "09:00", end: "10:00", pace: "normal" }])
            }
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
            dangerouslySetInnerHTML={{ __html: `${PLUS_SVG}${t("active_hours.add")}` }}
          />
        </div>
      </div>
      <p className="yui-sec__foot">{t("active_hours.foot")}</p>
    </div>
  );
}
