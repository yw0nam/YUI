/** The Motion page: the mouth gain, the idle and express motions, then the motion switch rows. */

import type { Logger } from "../../../logger";
import { DescriptorRow } from "../switches/descriptor-row";
import { ExpressMotionSection } from "./express-motion/express-motion-section";
import type { GainPreview } from "./gain/gain-preview";
import { GainRow } from "./gain/gain-row";
import { IdleMotionSection } from "./idle-motion/idle-motion-section";
import type { MotionPorts } from "./motion-ports";

export interface MotionPageViewProps {
  ports: MotionPorts;
  preview: GainPreview;
  log: Logger;
  /** Moves on each open; every source is read again. */
  revision: number;
}

export function MotionPageView({ ports, preview, log }: MotionPageViewProps) {
  return (
    <>
      <GainRow lipsync={ports.lipsync} preview={preview} log={log} />
      {ports.idleMotion && <IdleMotionSection {...ports.idleMotion} log={log} />}
      {ports.expressMotion && <ExpressMotionSection {...ports.expressMotion} log={log} />}
      <div className="yui-sec yui-motion-switches">
        <div className="yui-group">
          {ports.rows
            .filter((row) => row.isVisible)
            .map((row) => (
              <DescriptorRow key={row.selector} row={row} log={log} />
            ))}
        </div>
      </div>
    </>
  );
}
