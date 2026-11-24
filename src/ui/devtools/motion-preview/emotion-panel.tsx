/** The Emotion section: the emotion rows, intensity and transition, then → neutral and hold. */

import { useState } from "react";
import type { EmotionId } from "../../../contract";
import type { MotionPreview } from "./motion-preview";
import { SliderRow } from "./playback-row";
import { PreviewRow } from "./preview-row";

const EMOTION_ORDER: EmotionId[] = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "thinking",
  "curious",
  "sleepy",
  "embarrassed",
];

export function EmotionPanel({
  preview,
  active,
  onActive,
}: {
  /** Null until the renderer exists; the rows wait for it. */
  preview: MotionPreview | null;
  /** The emotion last applied. */
  active: EmotionId | null;
  onActive(id: EmotionId): void;
}) {
  const [intensity, setIntensity] = useState(1);
  const [transition, setTransition] = useState(250);

  return (
    <>
      {preview && (
        <ul className="motion-list">
          {EMOTION_ORDER.map((id) => {
            // The registry's mapping, not the key the renderer resolves.
            const expression = preview.emotions[id]?.vrm_expression;
            return (
              <li key={id}>
                <PreviewRow
                  name={id}
                  playing={active === id}
                  onPlay={() => {
                    preview.renderer.setEmotion({ id, intensity, transition_ms: transition });
                    onActive(id);
                  }}
                >
                  {expression && <span className="tag">{expression}</span>}
                </PreviewRow>
              </li>
            );
          })}
        </ul>
      )}
      <SliderRow
        label="intensity"
        min={0}
        max={1}
        step={0.05}
        value={intensity}
        text={intensity.toFixed(2)}
        onChange={setIntensity}
      />
      <SliderRow
        label="transition"
        min={0}
        max={1000}
        step={10}
        value={transition}
        text={`${transition}ms`}
        onChange={setTransition}
      />
      <div className="btn-row">
        <button
          type="button"
          className="yui-pill yui-pill--ok"
          onClick={() => {
            if (!preview) return;
            preview.renderer.setEmotion({ id: "neutral" });
            onActive("neutral");
          }}
        >
          → neutral
        </button>
        {/* null holds the current expression, so the lit row stays. */}
        <button
          type="button"
          className="yui-pill"
          onClick={() => preview?.renderer.setEmotion(null)}
        >
          hold (null)
        </button>
      </div>
    </>
  );
}
