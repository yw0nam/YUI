/** The Listening page: its React root, and the STT draft it commits on close and dispose. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Logger } from "../../../logger";
import type { ApiKeySettingsStore } from "../../../settings/backend/api-key-settings";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import type { createReadingsSettings } from "../../../settings/voice/readings-settings";
import type { createVadSettings } from "../../../settings/voice/vad-settings";
import type { VoiceInputStatus } from "../../chips/voice-input-status";
import { ListeningPageView } from "./listening-page-view";
import type { SttKeyCommit } from "./stt-key/stt-key-row";

type VadSettingsStore = ReturnType<typeof createVadSettings>;
type ReadingsSettingsStore = ReturnType<typeof createReadingsSettings>;

export interface ListeningPage {
  el: HTMLElement;
  /** Commits a dirty STT key draft. */
  close(): void;
  dispose(): void;
}

export function createListeningPage(deps: {
  showVoiceInput: boolean;
  voiceStatus: VoiceInputStatus;
  vad: VadSettingsStore;
  sttKeySettings: ApiKeySettingsStore;
  readingsSettings: ReadingsSettingsStore;
  bubblePersistSettings?: FlagSettingsStore;
  log: Logger;
}): ListeningPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const sttKeyCommit: SttKeyCommit = { current: null };
  const root = createRoot(el);
  flushSync(() => root.render(createElement(ListeningPageView, { ...deps, sttKeyCommit })));

  return {
    el,
    close(): void {
      sttKeyCommit.current?.();
    },
    dispose(): void {
      sttKeyCommit.current?.();
      root.unmount();
    },
  };
}
