/** The cue rows of one cue list, then its add row; a field commits on its native change. */

import { useEffect, useRef } from "react";
import type { Cue } from "../../../../settings/cues/cue-list-settings";
import { PLUS_SVG } from "../../constants";
import "../../../message/cue-list.css";
import { CueRow, type CueStore, type CueTrigger } from "./cue-row";

export interface CueListProps<C extends Cue> {
  /** The store's entries; the caller owns the subscription. */
  entries: C[];
  store: CueStore<C>;
  trigger: CueTrigger;
  addLabel: string;
}

export function CueList<C extends Cue>({ entries, store, trigger, addLabel }: CueListProps<C>) {
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onChange = (e: Event): void => {
      const f = e.target as HTMLInputElement | HTMLTextAreaElement;
      const cue = entries.find(
        (c) => c.id === f.closest<HTMLElement>("[data-cue-id]")?.dataset.cueId,
      );
      if (!cue) return;
      const update = (patch: Record<string, unknown>) =>
        store.updateCue(cue.id, patch as Partial<Omit<C, "id">>);
      if (f.matches(".yui-cue__name-input")) {
        const label = f.value.trim();
        if (label) update({ label });
        else f.value = cue.label;
      } else if (f.matches(".yui-cue__ctx-textarea")) {
        update({ context: f.value });
      } else if (trigger.kind === "minutes") {
        const n = Number(f.value);
        if (Number.isFinite(n) && n > 0) update({ [trigger.field]: n });
      } else {
        update({ [trigger.field]: f.value });
      }
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [entries, store, trigger]);

  return (
    <>
      <div className="yui-cue-list" ref={list}>
        {entries.map((cue) => (
          <CueRow key={cue.id} cue={cue} store={store} trigger={trigger} />
        ))}
      </div>
      <div className="yui-row yui-row--action">
        <button
          type="button"
          className="yui-add-btn"
          data-testid="cue-add"
          onClick={() => store.addCue()}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph beside the caller's translated label
          dangerouslySetInnerHTML={{ __html: `${PLUS_SVG}${addLabel}` }}
        />
      </div>
    </>
  );
}
