/** The relation line under the preset row: this window's preset, one relation per rated target. */

import { type DOMAttributes, useLayoutEffect, useRef, useState } from "react";
import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { glyphEl } from "./relation-glyph";
import { type RelationsView, ratedInOrder } from "./view";

/** One relation: the glyph, mounted as a vanilla element the re-renders keep, then the target's name. */
function RelationChip(p: {
  subject: string;
  target: string;
  band: ReturnType<typeof bandOf>;
  label: string;
  name: string;
  folded: boolean;
  describedBy?: string;
}) {
  const chip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const glyph = glyphEl("none");
    chip.current?.prepend(glyph);
    return () => glyph.remove();
  }, []);
  // The paint after this commit may move the glyph from its old band.
  useLayoutEffect(() => {
    const glyph = chip.current?.querySelector<HTMLElement>(".yui-glyph");
    if (glyph) glyph.dataset.band = p.band;
  }, [p.band]);
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a focusable chip its label names for the reasons card
    <span
      ref={chip}
      className="yui-relation"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the chip's reasons card
      tabIndex={0}
      data-subject={p.subject}
      data-target={p.target}
      data-folded={p.folded ? "" : undefined}
      aria-label={p.label}
      aria-describedby={p.describedBy}
    >
      <span className="yui-relation__to">{p.name}</span>
    </span>
  );
}

/** The `+N` chip for `n` folded chips, written during a measure. */
function setMoreCount(more: HTMLButtonElement, n: number): void {
  more.hidden = n === 0;
  more.textContent = `+${n}`;
  more.setAttribute("aria-label", t("relation.more", { n }));
}

/**
 * Folds the last shown chips but `user` into the `+N` chip until the line fits one row, measured
 * folded and from no width fold; returns the targets the width folded. A line not laid out folds none.
 */
function foldToWidth(line: HTMLElement, byWidth: readonly string[]): string[] {
  const more = line.querySelector<HTMLButtonElement>(".yui-relation--more");
  if (!more || line.clientWidth === 0) return [];
  const unfolded = line.classList.contains("is-unfolded");
  line.classList.remove("is-unfolded");
  const chips = [...line.querySelectorAll<HTMLElement>(".yui-relation[data-target]")];
  for (const chip of chips)
    if (byWidth.includes(chip.dataset.target!)) chip.removeAttribute("data-folded");
  let folded = chips.filter((chip) => chip.hasAttribute("data-folded")).length;
  const shown = chips.filter((c) => !c.hasAttribute("data-folded") && c.dataset.target !== "user");
  const out: string[] = [];
  setMoreCount(more, folded);
  while (line.scrollWidth > line.clientWidth && shown.length > 0) {
    const chip = shown.pop()!;
    chip.setAttribute("data-folded", "");
    out.push(chip.dataset.target!);
    folded += 1;
    setMoreCount(more, folded);
  }
  line.classList.toggle("is-unfolded", unfolded);
  return out;
}

export function RelationLine({
  view,
  isOpen,
  hidden,
  describedBy,
  handlers,
}: {
  view: RelationsView;
  isOpen: (id: string) => boolean;
  hidden: boolean;
  /** The card's id while it describes this target. */
  describedBy(target: string): string | undefined;
  /** The reasons card's pointer, focus and key handling over the chips. */
  handlers: Pick<
    DOMAttributes<HTMLDivElement>,
    "onPointerOver" | "onPointerOut" | "onFocus" | "onBlur" | "onKeyDown"
  >;
}) {
  const line = useRef<HTMLDivElement>(null);
  const [unfolded, setUnfolded] = useState(false);
  const [byWidth, setByWidth] = useState<readonly string[]>([]);
  const own = view.own;
  const targets = ratedInOrder(view.targets, own);
  const folds = (id: string): boolean => id !== "user" && !isOpen(id);
  // Open chips first, then the folded ones; each group keeps the value order.
  const ordered = [...targets.filter((id) => !folds(id)), ...targets.filter(folds)];
  const folded = (id: string): boolean => folds(id) || byWidth.includes(id);
  const count = ordered.filter(folded).length;

  // Every commit refolds to the width it measures; the fold the user opened stays.
  useLayoutEffect(() => {
    if (!line.current) return;
    const next = foldToWidth(line.current, byWidth);
    if (next.length !== byWidth.length || next.some((id, i) => id !== byWidth[i])) setByWidth(next);
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: the line the strip's CSS styles
    <div
      ref={line}
      className={unfolded ? "yui-preset__rel is-unfolded" : "yui-preset__rel"}
      role="group"
      aria-label={t("relation.group", { name: view.nameOf(view.self) })}
      hidden={hidden}
      {...handlers}
    >
      {ordered.length === 0 ? (
        <span className="yui-preset__rel-empty">{t("relation.none")}</span>
      ) : (
        <>
          {ordered.map((target) => {
            const band = bandOf(own[target]!.value);
            return (
              <RelationChip
                key={target}
                subject={view.self}
                target={target}
                band={band}
                label={view.label(target, band)}
                name={view.nameOf(target)}
                folded={folded(target)}
                describedBy={describedBy(target)}
              />
            );
          })}
          <button
            type="button"
            className="yui-relation yui-relation--more"
            hidden={count === 0}
            aria-label={t("relation.more", { n: count })}
            aria-expanded={unfolded}
            onClick={() => setUnfolded(!unfolded)}
          >
            {`+${count}`}
          </button>
        </>
      )}
    </div>
  );
}

/** Calls `onChange` when `el`'s width changes, never for its height; a no-op without ResizeObserver. */
export function observeWidth(el: HTMLElement, onChange: () => void): () => void {
  if (typeof ResizeObserver !== "function") return () => {};
  let width = -1;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    onChange();
  });
  observer.observe(el);
  return () => observer.disconnect();
}
