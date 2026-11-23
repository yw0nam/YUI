/** The Active hours editor: the span rows, the add action, and Reset to default; any edit writes the whole list. */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { Logger } from "../../../../logger";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import { spansInUse } from "../../../../settings/active-hours/card-active-hours";
import { type Pace, type Span, TIME_RE } from "../../../../settings/active-hours/spans";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { getLocale, t } from "../../../i18n";
import { SpanRow } from "./span-row";
import "./active-hours-section.css";
import { PLUS_GLYPH } from "../../glyphs";

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

  // The whole row list is one edit: read every row's times, write one setSpans; a pick names its row's pace.
  const commit = useCallback(
    (edit?: { skip: HTMLElement } | { index: number; pace: Pace }): void => {
      const rows = [...(list.current?.querySelectorAll<HTMLElement>(".yui-hours__span") ?? [])];
      const next: Span[] = [];
      for (const [i, row] of rows.entries()) {
        if (edit && "skip" in edit && row === edit.skip) continue;
        const [start, end] = row.querySelectorAll<HTMLInputElement>(".yui-time-input");
        if (!TIME_RE.test(start.value) || !TIME_RE.test(end.value)) return;
        const pace = edit && "index" in edit && edit.index === i ? edit.pace : spans[i]!.pace;
        next.push({ start: start.value, end: end.value, pace });
      }
      store.setSpans(next);
    },
    [store, spans],
  );

  const onChange = useCallback(
    (e: Event): void => {
      if ((e.target as HTMLElement).matches(".yui-time-input")) commit();
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
            <SpanRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a row is its position in the list
              key={i}
              span={span}
              onPace={(pace) => commit({ index: i, pace })}
              onRemove={(row) => commit({ skip: row })}
            />
          ))}
        </div>
        <div className="yui-row yui-row--action">
          <button
            className="yui-add-btn"
            type="button"
            onClick={() =>
              store.setSpans([...spans, { start: "09:00", end: "10:00", pace: "normal" }])
            }
          >
            {PLUS_GLYPH}
            {t("active_hours.add")}
          </button>
        </div>
      </div>
      <p className="yui-sec__foot">{t("active_hours.foot")}</p>
    </div>
  );
}
