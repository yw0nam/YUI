/** A motion or emotion row: one button with its dot, its name and its tags, lit while it plays. */

import type { ReactNode } from "react";

export function PreviewRow({
  name,
  playing,
  variant,
  onPlay,
  children,
}: {
  name: string;
  playing: boolean;
  /** An expanded pool entry, set in under its pool. */
  variant?: boolean;
  onPlay(): void;
  /** The tags. */
  children?: ReactNode;
}) {
  const className = ["motion-row", variant && "variant-row", playing && "state-playing"]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={className} onClick={onPlay}>
      <span className={playing ? "dot dot-filled" : "dot dot-hollow"} />
      <span className="row-name">{name}</span>
      <span className="row-tags">{children}</span>
    </button>
  );
}
