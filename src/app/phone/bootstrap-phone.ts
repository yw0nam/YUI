import type { AppConfig } from "../../config/load";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import { noopScreenCapturer } from "../../io/window/capture/screen-source-provider";
import { createLogger } from "../../logger";
import { createDisposers } from "../disposers";
import { type TurnCorePhase1, wireTurnCore } from "../turn/turn-core";
import type { VoiceHost, wireBroker } from "../turn/wire-voice";
import type { VoicePipeline } from "../turn/wire-voice-pipeline";

const log = createLogger("phone-bootstrap");

export interface PhoneBootstrapHandles {
  voice: VoicePipeline;
  dispatcher: Dispatcher;
  broker: Awaited<ReturnType<typeof wireBroker>>;
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
    const { broker, stopTurn } = await core.connect({ onSubmit: () => {} });
    return {
      voice: core.voice,
      dispatcher: core.dispatcher,
      broker,
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
