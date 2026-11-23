/** A page's own redraw: the open hook bumps it, and only that page's view renders again. */

import { type ReactNode, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export interface PageRevision {
  /** Renders the page again now, with the next revision. */
  bump(): void;
  /** Renders `render` with the current revision, again on each bump. */
  view(render: (revision: number) => ReactNode): ReactNode;
  subscribe(cb: () => void): () => void;
}

function Revised({
  subscribe,
  get,
  render,
}: {
  subscribe(cb: () => void): () => void;
  get(): number;
  render(revision: number): ReactNode;
}) {
  return render(useSyncExternalStore(subscribe, get));
}

export function createPageRevision(): PageRevision {
  let revision = 0;
  const subscribers = new Set<() => void>();
  const subscribe = (cb: () => void): (() => void) => {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };
  const get = (): number => revision;
  return {
    bump(): void {
      flushSync(() => {
        revision += 1;
        for (const cb of subscribers) cb();
      });
    },
    view: (render) => <Revised subscribe={subscribe} get={get} render={render} />,
    subscribe,
  };
}
