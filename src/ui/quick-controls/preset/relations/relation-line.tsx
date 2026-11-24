/** The relation line under the preset row: this window's preset, one relation per rated target. */

import { type DOMAttributes, useLayoutEffect, useRef } from "react";
import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { usePrepended } from "../use-prepended";
import { glyphEl } from "./relation-glyph";
import { type RelationsView, ratedInOrder } from "./view";

/** One relation: the glyph, mounted as a vanilla element the re-renders keep, then the target's name. */
function RelationChip(p: {
  subject: string;
  target: string;
  band: ReturnType<typeof bandOf>;
  label: string;
  name: string;
  describedBy?: string;
}) {
  const { host: chip, el: glyph } = usePrepended<HTMLSpanElement>(() => glyphEl("none"), []);
  // The paint after this commit may move the glyph from its old band.
  useLayoutEffect(() => {
    if (glyph.current) glyph.current.dataset.band = p.band;
  }, [glyph, p.band]);
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a focusable chip its label names for the reasons card
    <span
      ref={chip}
      className="yui-relation"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the chip's reasons card
      tabIndex={0}
      data-subject={p.subject}
      data-target={p.target}
      aria-label={p.label}
      aria-describedby={p.describedBy}
    >
      <span className="yui-relation__to">{p.name}</span>
    </span>
  );
}

/** The `+N` chip for `n` folded chips, whether a closed window or the line's width folded them. */
function setMoreCount(more: HTMLButtonElement, n: number): void {
  more.hidden = n === 0;
  more.textContent = `+${n}`;
  more.setAttribute("aria-label", t("relation.more", { n }));
}

/** Shows every folded chip, the line wrapping, or folds them back. */
function setUnfolded(line: HTMLElement, open: boolean): void {
  line.classList.toggle("is-unfolded", open);
  line.querySelector(".yui-relation--more")?.setAttribute("aria-expanded", String(open));
}

/**
 * Folds the chips of closed windows, then the last shown chips but `user`, into the `+N` chip until
 * the line fits one row, measured folded; a line not laid out folds by window only. React renders none
 * of the fold's attributes, so this is their one writer.
 */
function fold(line: HTMLElement, folds: (id: string) => boolean, unfolded: boolean): void {
  const more = line.querySelector<HTMLButtonElement>(".yui-relation--more");
  if (!more) return;
  line.classList.remove("is-unfolded");
  const chips = [...line.querySelectorAll<HTMLElement>(".yui-relation[data-target]")];
  for (const chip of chips) chip.toggleAttribute("data-folded", folds(chip.dataset.target!));
  let folded = chips.filter((chip) => chip.hasAttribute("data-folded")).length;
  setMoreCount(more, folded);
  if (line.clientWidth > 0) {
    const shown = chips.filter(
      (c) => !c.hasAttribute("data-folded") && c.dataset.target !== "user",
    );
    while (line.scrollWidth > line.clientWidth && shown.length > 0) {
      shown.pop()!.setAttribute("data-folded", "");
      folded += 1;
      setMoreCount(more, folded);
    }
  }
  setUnfolded(line, unfolded);
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
  // The fold the user opened, kept across re-renders until the chip is pressed again.
  const unfolded = useRef(false);
  const own = view.own;
  const targets = ratedInOrder(view.targets, own);
  const folds = (id: string): boolean => id !== "user" && !isOpen(id);
  // Open chips first, then the folded ones; each group keeps the value order.
  const ordered = [...targets.filter((id) => !folds(id)), ...targets.filter(folds)];

  // Every commit refolds to the width it measures; the fold the user opened stays.
  useLayoutEffect(() => {
    if (line.current) fold(line.current, folds, unfolded.current);
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: the line the header's CSS styles
    <div
      ref={line}
      className="yui-preset__rel"
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
                describedBy={describedBy(target)}
              />
            );
          })}
          <button
            type="button"
            className="yui-relation yui-relation--more"
            onClick={() => {
              unfolded.current = !unfolded.current;
              if (line.current) setUnfolded(line.current, unfolded.current);
            }}
          />
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
