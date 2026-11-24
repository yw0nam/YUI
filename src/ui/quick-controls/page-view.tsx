/** A page as the panel renders it: its element around its view, and its own redraw. */

import { type ReactNode, type Ref, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/** A page controller as the panel sees it. */
export interface PageView {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
}

interface PageRevision {
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

/** A page's own redraw: the open hook bumps it, and only that page's view renders again. */
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

/** The page's element, `div.yui-tab-stack` and any class the page adds, around its view; with a revision, the view renders again on each bump. */
export function pageStack(
  render: (revision: number) => ReactNode,
  o: { revision?: PageRevision; className?: string; ref?: Ref<HTMLDivElement> } = {},
): ReactNode {
  return (
    <div ref={o.ref} className={o.className ? `yui-tab-stack ${o.className}` : "yui-tab-stack"}>
      {o.revision ? o.revision.view(render) : render(0)}
    </div>
  );
}
