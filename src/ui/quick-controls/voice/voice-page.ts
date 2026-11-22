/** The Voice page: its React root, what the panel's open redraws, and the audition its close stops. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { AuditionPort } from "./speaker/speaker-section";
import { VoicePageView, type VoicePageViewProps } from "./voice-page-view";

export interface VoicePage {
  el: HTMLElement;
  /** Re-reads every source and drops an armed remove: the open hook. */
  refresh(): void;
  /** Stops the audition: the close hook. */
  close(): void;
  dispose(): void;
}

export function createVoicePage(
  deps: Omit<VoicePageViewProps, "speaker" | "revision"> &
    Omit<VoicePageViewProps["speaker"], "audition" | "log">,
): VoicePage {
  const { rows, fillerSettings, log, ...speaker } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  const audition: AuditionPort = { stop: null };
  const props = { rows, fillerSettings, log, speaker: { ...speaker, log, audition } };
  let revision = 0;
  const render = (): void =>
    flushSync(() => root.render(createElement(VoicePageView, { ...props, revision })));
  render();

  return {
    el,
    refresh(): void {
      revision++;
      render();
    },
    close(): void {
      audition.stop?.();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
