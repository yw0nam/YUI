/**
 * The Motion panel: empty before its first activation, the error text after a failed load, else the
 * preview — the viewport the renderer draws in beside the rail of controls over the status bar.
 */

import "./motion-preview.css";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EmotionId } from "../../../contract";
import { t } from "../../i18n";
import { EmotionPanel } from "./emotion-panel";
import type { Clip } from "./live-status";
import type { MotionLoad } from "./motion-load";
import type { MotionPreview } from "./motion-preview";
import { PLAYBACK_DEFAULTS, PlaybackControls } from "./playback-controls";
import { RegistryList } from "./registry-list";

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="section-header">
      <span className="section-label">{label}</span>
      <div className="section-divider" />
    </div>
  );
}

function Preview({ attach }: { attach: MotionLoad["attach"] }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const kind = useRef<HTMLSpanElement>(null);
  const priority = useRef<HTMLSpanElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const fps = useRef<HTMLSpanElement>(null);
  const emotionNow = useRef<EmotionId | null>(null);
  const [preview, setPreview] = useState<MotionPreview | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [emotion, setEmotion] = useState<EmotionId | null>(null);
  const [playback, setPlayback] = useState(PLAYBACK_DEFAULTS);

  // Here, not in a child's effect, so every element below has its ref when the core reads them.
  useLayoutEffect(
    () =>
      attach({
        host: host.current!,
        status: {
          now: now.current!,
          kind: kind.current!,
          priority: priority.current!,
          elapsed: elapsed.current!,
          fps: fps.current!,
          viewport: viewport.current!,
        },
        emotion: () => emotionNow.current,
        ready: setPreview,
        clip: setClip,
      }),
    [attach],
  );

  const play = (id: string) =>
    preview?.renderer.playMotion({
      id,
      loop: playback.loop,
      speed: playback.speed,
      fade_ms: playback.fade,
    });

  return (
    <div className="motion-preview">
      <div className="motion-preview__viewport">
        <div className="viewport-label">VRM Viewport</div>
        <div id="vrm-mount" ref={host} />
        <div className="viewport-status" ref={viewport} />
      </div>
      <div className="motion-preview__rail">
        <div className="rail-scroll">
          <div className="section">
            <SectionHeader label="Registry" />
            {preview ? (
              <RegistryList
                registry={preview.registry}
                variantIds={preview.variantIds}
                clip={clip}
                onPlay={play}
              />
            ) : (
              <div className="devtools-loading">{t("devtools.loading_motion")}</div>
            )}
          </div>
          <div className="section-sep" />
          <div className="playback-section">
            <SectionHeader label="Playback" />
            <PlaybackControls
              value={playback}
              ids={preview ? Object.keys(preview.registry) : []}
              onChange={setPlayback}
              onPlay={() => play(playback.crossfade)}
              onIdle={() => play("idle")}
            />
          </div>
          <div className="section-sep" />
          <div className="section">
            <SectionHeader label="Emotion" />
            <EmotionPanel
              preview={preview}
              active={emotion}
              onActive={(id) => {
                emotionNow.current = id;
                setEmotion(id);
              }}
            />
          </div>
        </div>
        <div className="status-bar">
          <span className="status-text">
            <span className="status-key">now: </span>
            <span className="status-accent" ref={now} />
            <span className="status-key"> · </span>
            <span className="status-val" ref={kind} />
            <span className="status-key"> · </span>
            <span className="status-val" ref={priority} />
            <span className="status-key"> · </span>
            <span className="status-val" ref={elapsed} />
            <span className="status-key"> · </span>
            <span className="status-val" ref={fps} />
          </span>
        </div>
      </div>
    </div>
  );
}

export function MotionPanel({ motion }: { motion: MotionLoad }) {
  const state = useSyncExternalStore(motion.subscribe, motion.state);
  if (state === "idle") return null;
  if (state === "failed") {
    return <div className="devtools-error">{t("devtools.motion_load_failed")}</div>;
  }
  return <Preview attach={motion.attach} />;
}
