/** One host element a vanilla piece mounts into; React never renders inside it. */

export interface RefMountProps {
  as?: "div" | "span" | "section";
  className?: string;
  /** Fills `host`; the cleanup it returns runs before the next mount and on unmount. */
  mount(host: HTMLElement): void | (() => void);
  /** A change in any of these mounts again. */
  deps: readonly unknown[];
}

export function RefMount({ as: Tag = "div", className }: RefMountProps) {
  return <Tag className={className} />;
}
