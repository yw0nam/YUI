/** The Voice page: its view, what the panel's open redraws, and the audition its close stops. */

import { createElement, type ReactNode } from "react";
import { createPageRevision } from "../page-revision";
import { createAudition } from "./speaker/audition";
import { VoicePageView, type VoicePageViewProps } from "./voice-page-view";

export interface VoicePage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Re-reads every source and drops an armed remove: the open hook. */
  refresh(): void;
  /** Stops the audition: the close hook, and the last step of the panel's teardown. */
  close(): void;
}

export function createVoicePage(
  deps: Omit<VoicePageViewProps, "speaker" | "revision"> &
    Omit<VoicePageViewProps["speaker"], "audition" | "log" | "revision">,
): VoicePage {
  const { rows, fillerSettings, log, ...speaker } = deps;
  const audition = createAudition();
  const props = { rows, fillerSettings, log, speaker: { ...speaker, log, audition } };
  const revision = createPageRevision();
  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack" },
        revision.view((n) => createElement(VoicePageView, { ...props, revision: n })),
      ),
    refresh: revision.bump,
    close: audition.stop,
  };
}
