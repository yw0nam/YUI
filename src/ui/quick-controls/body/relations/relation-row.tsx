/** One relations row: the glyph, the target's name and sub line, and a slider that previews on drag and commits on release. */

import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import type { RelationBand } from "../../../../contract/types";
import type { Logger } from "../../../../logger";
import {
  bandOf,
  MAX,
  type RelationRecord,
  SET_BY_USER,
} from "../../../../settings/relations/relations-store";
import { Slider } from "../../../controls/slider";
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
  const label = useRef<HTMLSpanElement>(null);
  const glyph = useRef<HTMLElement>(null);

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

  function commit(next: number): void {
    const { band: stored, applied } = store.set(target, next, SET_BY_USER, Date.now());
    if (applied > 0) log.info("relation_set", { target, value: next, band: stored });
    setDraft(null);
  }

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
      <div
        className="yui-relations__ctl"
        style={
          {
            "--pos": String(Math.max(0, value) / (2 * MAX)),
            "--neg": String(Math.max(0, -value) / (2 * MAX)),
          } as CSSProperties
        }
      >
        <Slider
          className="yui-relations__slider"
          min={-MAX}
          max={MAX}
          step={1}
          value={value}
          onValueChange={setDraft}
          onValueCommitted={commit}
          label={t("relations.slider_aria", { name: selfName, target: name })}
          valueText={
            rated ? `${t(`relation.band.${band}`)}, ${signed(value)}` : t("relations.not_rated")
          }
          data-band={band}
        />
        <span className="yui-relations__value">{signed(value)}</span>
      </div>
    </div>
  );
}
