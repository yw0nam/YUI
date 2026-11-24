/** The reasons card: on hover or focus of a relation, its band, the engine's note and the last three reasons. */

import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { bandOf, type RelationRecord } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { ageText, directionHtml } from "./relation-glyph";

const CARD_ID = "yui-reasons";

interface Opened {
  subject: string;
  target: string;
  /** What the card was opened over; a change of any of them closes it. */
  over: readonly unknown[];
}

const relationOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>(".yui-relation[data-target]") : null;

export function useReasonsCard(deps: {
  header: RefObject<HTMLElement | null>;
  recordOf(subject: string, target: string): RelationRecord | undefined;
  nameOf(id: string): string;
  /** The sources the line renders from; the card closes when one changes, as the line redraws. */
  closeOn: readonly unknown[];
}) {
  const { header, closeOn } = deps;
  const card = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  // Escape keeps the card shut for this relation until the pointer leaves it.
  const escaped = useRef<HTMLElement | null>(null);
  const shown = opened?.over.every((v, i) => v === closeOn[i])
    ? { ...opened, record: deps.recordOf(opened.subject, opened.target) }
    : null;
  const openFor = (): HTMLElement | null =>
    shown
      ? (header.current?.querySelector<HTMLElement>(
          `.yui-relation[data-subject="${shown.subject}"][data-target="${shown.target}"]`,
        ) ?? null)
      : null;

  function open(relation: HTMLElement): void {
    const { subject = "", target = "" } = relation.dataset;
    if (!deps.recordOf(subject, target)) return;
    setOpened({ subject, target, over: closeOn });
  }

  // Placed under its relation once filled, inside the header.
  useLayoutEffect(() => {
    const relation = openFor();
    const el = card.current;
    if (!relation || !el || !header.current) return;
    const headerBox = header.current.getBoundingClientRect();
    const box = relation.getBoundingClientRect();
    el.style.left = "0px";
    const left = Math.min(
      box.left - headerBox.left,
      header.current.clientWidth - el.offsetWidth - 6,
    );
    el.style.left = `${Math.max(6, left)}px`;
    el.style.top = `${box.bottom - headerBox.top + 6}px`;
  });

  const handlers = {
    onPointerOver(e: PointerEvent): void {
      const relation = relationOf(e.target);
      if (relation && relation !== escaped.current) open(relation);
    },
    onPointerOut(e: PointerEvent): void {
      const relation = relationOf(e.target);
      if (!relation || relation.contains(e.relatedTarget as Node | null)) return;
      if (relation === escaped.current) escaped.current = null;
      if (relation === openFor() && document.activeElement !== relation) setOpened(null);
    },
    onFocus(e: FocusEvent): void {
      const relation = relationOf(e.target);
      if (relation) open(relation);
    },
    onBlur(e: FocusEvent): void {
      if (relationOf(e.target) === openFor()) setOpened(null);
    },
    // Esc closes the card alone; the panel stays open behind it.
    onKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Escape" || !shown) return;
      e.stopPropagation();
      escaped.current = openFor();
      setOpened(null);
    },
  };

  const record = shown?.record;
  const [before = "", after = ""] = shown
    ? t("relation.card_head", {
        subject: deps.nameOf(shown.subject),
        band: "\u0000",
        target: deps.nameOf(shown.target),
      }).split("\u0000")
    : [];

  return {
    handlers,
    describedBy: (subject: string, target: string): string | undefined =>
      shown?.subject === subject && shown.target === target ? CARD_ID : undefined,
    card: (
      <div
        ref={card}
        className={shown ? "yui-reasons is-open" : "yui-reasons"}
        id={CARD_ID}
        role="tooltip"
      >
        {shown && record && (
          <>
            <p className="yui-reasons__head">
              {before}
              <b>{t(`relation.band.${bandOf(record.value)}`)}</b>
              {after}
            </p>
            {record.note && <p className="yui-reasons__note">{record.note}</p>}
            <ol>
              {record.log.slice(0, 3).map((change) => (
                <li key={`${change.at}${change.why}`}>
                  <span
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: the static chevron and its word for a screen reader
                    dangerouslySetInnerHTML={{ __html: directionHtml(change.delta) }}
                  />
                  <span>{change.why}</span>
                  <span className="yui-reasons__age">{ageText(Date.now() - change.at)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    ),
  };
}
