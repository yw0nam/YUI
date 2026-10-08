import type { AppConfig } from "../../config/load";
import { noopScreenCapturer } from "../../io/window/capture/screen-source-provider";
import { createLogger } from "../../logger";
import { createDisposers } from "../disposers";
import { type TurnCorePhase1, wireTurnCore } from "../turn/turn-core";
import type { wireVocabulary } from "../turn/vocabulary/wire-vocabulary";
import type { VoiceHost } from "../turn/voice/wire-voice";

const log = createLogger("phone-bootstrap");

export interface PhoneBootstrapHandles {
  vocabulary: Awaited<ReturnType<typeof wireVocabulary>>;
  stopTurn: () => string[];
  dispose(): void;
}

/** The phone's chat turn, started and connected under one teardown bag once the config has loaded. */
export async function createPhoneBootstrap(
  cfg: AppConfig,
  phase1: TurnCorePhase1 & { isDisposed(): boolean; voiceHost: VoiceHost },
): Promise<PhoneBootstrapHandles> {
  const disposers = createDisposers();
  const ensureActive = (): void => {
    if (phase1.isDisposed()) throw new Error("bootstrap disposed during configured construction");
  };
  try {
    const core = await wireTurnCore(cfg, phase1, {
      getFrontmost: () => undefined,
      screenCapturer: noopScreenCapturer,
      voiceHost: phase1.voiceHost,
      register: disposers.register,
      ensureActive,
    });
    core.start();
    // The phone has no proactive source to tell about a submit.
    const { vocabulary, stopTurn } = await core.connect({ onSubmit: () => {} });
    return {
      vocabulary,
      stopTurn,
      dispose: disposers.dispose,
    };
  } catch (error) {
    try {
      disposers.dispose();
    } catch (teardownError) {
      log.warn("phone_bootstrap_teardown_failed", { error: String(teardownError) });
    }
    throw error;
  }
}
