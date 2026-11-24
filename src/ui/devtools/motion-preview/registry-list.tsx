/** The Registry section: the motion rows grouped by kind, the playing one lit, and idle's variant line. */

import { useState } from "react";
import type { MotionKind, MotionRegistry } from "../../../contract";
import type { Clip } from "./live-status";
import { PreviewRow } from "./preview-row";
import { variantName } from "./variants";

const KIND_ORDER: MotionKind[] = ["ambient", "reactive", "state", "oneshot"];

/** Which of idle's variants played last; the first until one does. */
function IdleLine({ variants, clip }: { variants: string[]; clip: Clip | null }) {
  const [path, setPath] = useState(variants[0]!);
  if (clip?.id === "idle" && clip.vrma_path !== path && variants.includes(clip.vrma_path)) {
    setPath(clip.vrma_path);
  }
  return (
    <div className="sub-line">
      variant <span>{`${variants.indexOf(path) + 1}/${variants.length}`}</span>
      {` · ${variantName(path)}`}
    </div>
  );
}

export function RegistryList({
  registry,
  variantIds,
  clip,
  onPlay,
}: {
  registry: MotionRegistry;
  variantIds: Set<string>;
  clip: Clip | null;
  onPlay(id: string): void;
}) {
  const entries = Object.entries(registry);
  return KIND_ORDER.map((kind) => {
    const group = entries.filter(([, entry]) => entry.kind === kind);
    if (group.length === 0) return null;
    return (
      <div key={kind} className="group">
        <div className="group-label">{kind}</div>
        <ul className="motion-list">
          {group.map(([id, entry]) => (
            <li key={id}>
              <PreviewRow
                name={id}
                playing={clip?.id === id}
                variant={variantIds.has(id)}
                onPlay={() => onPlay(id)}
              >
                <span className="tag">{`p${entry.priority}`}</span>
                {entry.loop && <span className="tag tag-loop">loop</span>}
              </PreviewRow>
              {id === "idle" && entry.variants && entry.variants.length > 0 && (
                <IdleLine variants={entry.variants} clip={clip} />
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  });
}
