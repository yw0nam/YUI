/** One relations row: the glyph, the target's name and sub line, and a slider that previews on drag and commits on release. */

import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RelationBand } from "../../../../contract/types";
import type { Logger } from "../../../../logger";
import {
  bandOf,
  MAX,
  type RelationRecord,
  SET_BY_USER,
} from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { ageText, glyphEl } from "../../preset/relations/relation-glyph";
import type { RelationsPort } from "./relations-port";

/** `+9`, `−6` with a true minus, `0`. */
const signed = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

/** The band word, then the last reason and its age; no record reads `fallback`. */
function subText(band: RelationBand, record: RelationRecord | undefined, fallback: string): string {
  if (!record) return fallback;
  const last = record.log[0];
  const why = last?.why === SET_BY_USER ? t("relations.set_by_you") : (last?.why ?? "");
  const age = ageText(Date.now() - (last?.at ?? record.updated_at));
  return [t(`relation.band.${band}`), why, age].filter(Boolean).join(" · ");
}

export function RelationRow({
  target,
  name,
  selfName,
  record,
  firstUnrated,
  store,
  log,
}: {
  target: string;
  name: string;
  selfName: string;
  record: RelationRecord | undefined;
  firstUnrated: boolean;
  store: RelationsPort["store"];
  log: Logger;
}) {
  // The slider's value while it is held; null at rest, when the stored record shows.
  const [draft, setDraft] = useState<number | null>(null);
  const slider = useRef<HTMLInputElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const glyph = useRef<HTMLElement>(null);
  const refocus = useRef(false);

  const value = draft ?? record?.value ?? 0;
  const band = bandOf(value);
  const rated = draft !== null || !!record;

  useLayoutEffect(() => {
    const el = glyphEl("none");
    label.current?.prepend(el);
    glyph.current = el;
    return () => el.remove();
  }, []);
  useLayoutEffect(() => {
    if (glyph.current) glyph.current.dataset.band = rated ? band : "none";
  }, [rated, band]);

  // A release commits on the native change event, which React's onChange does not carry.
  useEffect(() => {
    const el = slider.current;
    if (!el) return;
    const commit = (): void => {
      const next = Number(el.value);
      refocus.current = el.ownerDocument.activeElement === el;
      const { band: stored, applied } = store.set(target, next, SET_BY_USER, Date.now());
      if (applied > 0) log.info("relation_set", { target, value: next, band: stored });
      setDraft(null);
    };
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [store, target, log]);

  // The row moved to its new place, and a moved focused node loses focus in WebKit.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    slider.current?.focus();
  });

  return (
    <div
      className={[
        "yui-row yui-relations__row",
        !record && "is-unrated",
        firstUnrated && "is-first-unrated",
      ]
        .filter(Boolean)
        .join(" ")}
      data-target={target}
    >
      <div className="yui-row__main">
        <span className="yui-row__label" ref={label}>
          <span className="yui-relations__name">{name}</span>
        </span>
        <span className="yui-row__sub">
          {subText(
            band,
            record,
            draft !== null ? t(`relation.band.${band}`) : t("relations.not_rated"),
          )}
        </span>
      </div>
      <div className="yui-relations__ctl">
        <input
          ref={slider}
          type="range"
          className="yui-gain__slider yui-relations__slider"
          min={-MAX}
          max={MAX}
          step={1}
          value={value}
          onChange={(e) => setDraft(Number(e.target.value))}
          aria-label={t("relations.slider_aria", { name: selfName, target: name })}
          aria-valuetext={
            rated ? `${t(`relation.band.${band}`)}, ${signed(value)}` : t("relations.not_rated")
          }
          data-band={band}
          style={
            {
              "--pos": String(Math.max(0, value) / (2 * MAX)),
              "--neg": String(Math.max(0, -value) / (2 * MAX)),
            } as CSSProperties
          }
        />
        <span className="yui-relations__value">{signed(value)}</span>
      </div>
    </div>
  );
}
