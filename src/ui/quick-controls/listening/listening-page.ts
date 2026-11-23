/** The Listening page: its view, and the STT draft it commits on close and teardown. */

import { createElement } from "react";
import type { Logger } from "../../../logger";
import type { ApiKeySettingsStore } from "../../../settings/backend/api-key-settings";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import type { createReadingsSettings } from "../../../settings/voice/readings-settings";
import type { createVadSettings } from "../../../settings/voice/vad-settings";
import type { VoiceInputStatus } from "../../chips/voice-input-status";
import { type PageView, pageStack } from "../page-view";
import type { KeyRowCommit } from "../sections/key-row/key-row";
import { ListeningPageView } from "./listening-page-view";

type VadSettingsStore = ReturnType<typeof createVadSettings>;
type ReadingsSettingsStore = ReturnType<typeof createReadingsSettings>;

export interface ListeningPage extends PageView {
  /** Commits a dirty STT key draft. */
  close(): void;
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
  const sttKeyCommit: KeyRowCommit = { current: null };
  return {
    view: () => pageStack(() => createElement(ListeningPageView, { ...deps, sttKeyCommit })),
    close(): void {
      sttKeyCommit.current?.();
    },
  };
}
