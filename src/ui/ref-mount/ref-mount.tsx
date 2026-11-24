/** One host element a vanilla piece mounts into; React never renders inside it. */

import { useLayoutEffect, useRef } from "react";

export interface RefMountProps {
  as?: "div" | "span" | "section";
  className?: string;
  /** Fills `host`; the cleanup it returns runs before the next mount and on unmount. */
  mount(host: HTMLElement): (() => void) | undefined;
  /** A change in any of these mounts again. */
  deps: readonly unknown[];
}

export function RefMount({ as: Tag = "div", className, mount, deps }: RefMountProps) {
  const host = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps say when `mount` draws something new.
  useLayoutEffect(() => mount(host.current!), deps);
  return <Tag ref={host as never} className={className} />;
}
