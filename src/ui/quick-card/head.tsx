/** The quick card's head: the face, the name and transport line, and the ×; the head itself is the drag handle. */

import { useLayoutEffect, useRef } from "react";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import { CROSS_SVG } from "../quick-controls/constants";
import { avatarEl } from "../unified/avatar";
import type { QuickCardDeps } from "./quick-card";
import { transportLine } from "./transport-line";
import { useSnapshot } from "./use-snapshot";

function Face({ entry }: { entry: PresetEntry }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => host.current?.replaceChildren(avatarEl(entry, 30)), [entry]);
  return <span className="yui-qcard__face" ref={host} />;
}

export function Head({
  deps,
  close,
  onPointerDown,
}: {
  deps: QuickCardDeps;
  close(): void;
  onPointerDown(event: PointerEvent): void;
}) {
  const entry = useSnapshot(deps.entry, deps.subscribeEntry);
  const transport = useSnapshot(deps.transport, deps.onTransport);
  return (
    <div
      className="yui-qcard__head"
      onPointerDown={(e) => {
        // The head drags the window; its × keeps its click.
        if ((e.target as HTMLElement).closest("button")) return;
        onPointerDown(e.nativeEvent);
      }}
    >
      <Face entry={entry} />
      <span className="yui-qcard__id">
        <span className="yui-qcard__name" id="yui-qcard-name">
          {entry.name}
        </span>
        <span className="yui-qcard__transport">{transportLine(transport)}</span>
      </span>
      <button
        className="yui-qcard__close"
        type="button"
        aria-label={t("quick_card.close")}
        onClick={close}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
        dangerouslySetInnerHTML={{ __html: CROSS_SVG }}
      />
    </div>
  );
}
