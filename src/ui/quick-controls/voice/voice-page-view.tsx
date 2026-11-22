/** The Voice page: the TTS switch and the speaker list, the thinking filler, then the message-window row. */

import type { Logger } from "../../../logger";
import type { createFillerSettings } from "../../../settings/voice/filler-settings";
import type { SwitchRow } from "../switch-row";
import { DescriptorRow } from "../switches/descriptor-row";
import { FillerSection } from "./filler/filler-section";
import { SpeakerSection, type SpeakerSectionProps } from "./speaker/speaker-section";

export interface VoicePageViewProps {
  /** The page's switch-row descriptors: the TTS row, the filler row and the message-window row. */
  rows: readonly SwitchRow[];
  fillerSettings: ReturnType<typeof createFillerSettings>;
  speaker: Omit<SpeakerSectionProps, "revision">;
  log: Logger;
  /** Moves on each open; every source is read again. */
  revision: number;
}

export function VoicePageView({
  rows,
  fillerSettings,
  speaker,
  log,
  revision,
}: VoicePageViewProps) {
  const visible = rows.filter((row) => row.isVisible);
  const fillerRow = visible.find((row) => row.position === "filler");
  const rowsAt = (position: SwitchRow["position"]) =>
    visible
      .filter((row) => row.position === position)
      .map((row) => <DescriptorRow key={row.selector} row={row} log={log} />);
  return (
    <>
      <div className="yui-sec">
        <div className="yui-group">{rowsAt(undefined)}</div>
        <SpeakerSection {...speaker} revision={revision} />
      </div>
      {fillerRow && <FillerSection settings={fillerSettings} row={fillerRow} revision={revision} />}
      <div className="yui-sec">
        <div className="yui-group">{rowsAt("after-filler")}</div>
      </div>
    </>
  );
}
