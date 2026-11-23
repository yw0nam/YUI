/** The Voice page: its React root, what the panel's open redraws, and the audition its close stops. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createAudition } from "./speaker/audition";
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
    Omit<VoicePageViewProps["speaker"], "audition" | "log"> & { host: HTMLElement },
): VoicePage {
  const { rows, fillerSettings, log, host, ...speaker } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  // The page appends itself here before its first render: Base UI registers a radio group's items only while connected.
  host.append(el);
  const root = createRoot(el);
  const audition = createAudition();
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
    close: audition.stop,
    dispose(): void {
      root.unmount();
      audition.stop();
    },
  };
}
