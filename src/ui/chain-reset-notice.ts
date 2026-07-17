/**
 * showChainResetNotice — one-off system notice through the existing speech
 * bubble, bypassing TTS. Fires when the backend caller recovers from a lost
 * previous_response_id (404 chain break) by resetting conversation state.
 */

export interface ChainResetNoticeDeps {
  surfaces: {
    beginSpeech(): void;
    pushSpeech(t: string): void;
    endSpeech(): void;
  };
  t: (key: string) => string;
}

export function showChainResetNotice(deps: ChainResetNoticeDeps): void {
  deps.surfaces.beginSpeech();
  deps.surfaces.pushSpeech(deps.t("chain.reset_notice"));
  deps.surfaces.endSpeech();
}
