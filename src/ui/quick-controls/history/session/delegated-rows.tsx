/** Mounts the shared delegation rows, which reconcile in place on each commit and keep their open summaries. */

import { useLayoutEffect, useRef, useState } from "react";
import type { DelegationItem } from "../../../../io/chat/push/push-frames";
import { renderDelegationRows } from "../../../chips/delegation-rows";

export function DelegatedRows({ items }: { items: DelegationItem[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [open] = useState(() => new Set<string>());
  useLayoutEffect(() => {
    const draw = (): void =>
      renderDelegationRows(host.current!, items, Date.now(), { open, onToggle: draw });
    draw();
  });
  return <div className="yui-session__deleg-rows" ref={host} />;
}
