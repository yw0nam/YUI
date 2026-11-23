import { type DependencyList, type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Keeps a vanilla element first inside the host: `create` builds it after each commit where `deps`
 * changed, and the cleanup removes it. Returns the host's ref and the element's.
 */
export function usePrepended<T extends HTMLElement>(
  create: () => HTMLElement,
  deps: DependencyList,
): { host: RefObject<T | null>; el: RefObject<HTMLElement | null> } {
  const host = useRef<T>(null);
  const el = useRef<HTMLElement | null>(null);
  useLayoutEffect(
    () => {
      const made = create();
      host.current?.prepend(made);
      el.current = made;
      return () => {
        made.remove();
        el.current = null;
      };
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller names what rebuilds the element
    deps,
  );
  return { host, el };
}
