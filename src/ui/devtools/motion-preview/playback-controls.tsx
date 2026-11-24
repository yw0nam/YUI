/** The Playback section: loop, speed, fade and the crossfade clip, then play, stop and back to idle. */

import { Checkbox } from "../../controls/checkbox";
import { Select } from "../../controls/select";
import { PlaybackRow, SliderRow } from "./playback-row";

export interface Playback {
  loop: boolean;
  speed: number;
  fade: number;
  /** The clip the play button starts. */
  crossfade: string;
}

export const PLAYBACK_DEFAULTS: Playback = { loop: true, speed: 1, fade: 200, crossfade: "idle" };

/** 1.5 → "1.5x" */
function formatSpeed(v: number): string {
  return `${v.toFixed(2).replace(/\.?0+$/, "")}x`;
}

export function PlaybackControls({
  value,
  ids,
  onChange,
  onPlay,
  onIdle,
}: {
  value: Playback;
  /** The clips the crossfade select lists. */
  ids: readonly string[];
  onChange(value: Playback): void;
  onPlay(): void;
  /** Stop and → idle both replay idle: the renderer has no stop. */
  onIdle(): void;
}) {
  return (
    <>
      <PlaybackRow label="loop">
        <Checkbox
          label="loop"
          checked={value.loop}
          onCheckedChange={(loop) => onChange({ ...value, loop })}
        />
      </PlaybackRow>
      <SliderRow
        label="speed"
        min={0.25}
        max={2.5}
        step={0.05}
        value={value.speed}
        text={formatSpeed(value.speed)}
        onChange={(speed) => onChange({ ...value, speed })}
      />
      <SliderRow
        label="fade"
        min={0}
        max={600}
        step={10}
        value={value.fade}
        text={`${value.fade}ms`}
        onChange={(fade) => onChange({ ...value, fade })}
      />
      <PlaybackRow label="crossfade →">
        <Select
          aria-label="crossfade"
          value={value.crossfade}
          items={ids.map((id) => ({ value: id, label: id }))}
          onValueChange={(crossfade) => onChange({ ...value, crossfade })}
        />
      </PlaybackRow>
      <div className="btn-row">
        <button type="button" className="yui-pill yui-pill--ok" onClick={onPlay}>
          play
        </button>
        <button type="button" className="yui-pill" onClick={onIdle}>
          stop
        </button>
        <button type="button" className="yui-pill btn-idle" onClick={onIdle}>
          → idle
        </button>
      </div>
    </>
  );
}
