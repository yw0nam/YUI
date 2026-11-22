/** The Body page: the VRM section, the relations rows when rendered, then the view reset when rendered. */

import type { Logger } from "../../../logger";
import { RelationsEditSection } from "./relations/relations-edit-section";
import type { RelationsPort } from "./relations/relations-port";
import { ViewpointRow } from "./viewpoint/viewpoint-row";
import type { VrmListDeps } from "./vrm/use-vrm-list";
import { VrmSection } from "./vrm/vrm-section";

export interface BodyPageViewProps {
  vrm: Omit<VrmListDeps, "revision">;
  /** Absent where the relations rows are not rendered. */
  relations?: RelationsPort;
  /** Absent where the view reset is not rendered. */
  onResetView?(): void;
  log: Logger;
  /** Moves on each open; every source is read again. */
  revision: number;
}

export function BodyPageView({ vrm, relations, onResetView, log, revision }: BodyPageViewProps) {
  return (
    <>
      <VrmSection {...vrm} revision={revision} />
      {relations && <RelationsEditSection {...relations} />}
      {onResetView && <ViewpointRow onReset={onResetView} log={log} />}
    </>
  );
}
