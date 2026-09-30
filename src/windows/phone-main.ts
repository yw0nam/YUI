/**
 * Phone bootstrap — phone.html entry point, the Android window.
 *
 * Graph: stores + config → createRenderer(stage) + Tier 1 → createSurfaces (persistent composer)
 *   → push stores → config.load() → createPhoneBootstrap (turn core) → wirePushMode (socket).
 * The root follows the visual viewport, so the soft keyboard shortens the stage.
 */

import "../styles.css";
import "../ui/phone/phone.css";
import { createTier1Engine } from "../ambient/liveliness/tier1";
import { registerRendererAndAmbientDisposal } from "../app/bootstrap-disposal";
import { createDisposers } from "../app/disposers";
import { createPhoneBootstrap } from "../app/phone/bootstrap-phone";
import { createConversationStores } from "../app/settings/conversation-stores";
import { wireSpeakerSelection, wireVrmSelection } from "../app/settings/wire-avatar";
import { createPetConfig } from "../app/settings/wire-config";
import { wireCamera } from "../app/stage/wire-pet-stage";
import { createPushStores } from "../app/turn/push-stores";
import { wirePushMode } from "../app/turn/wire-push";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../config/load";
import { createEventBus } from "../dispatcher/core/event-bus";
import { createUserInputSource } from "../dispatcher/sources/user-input-source";
import { wireVoiceListAutoRefresh } from "../io/voice/voices/voice-list-refresh";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { createRenderer } from "../renderer";
import { createSettingsStores } from "../settings/settings-stores";
import { createVoiceInputStatus } from "../ui/chips/voice-input-status";
import { getLocale } from "../ui/i18n";
import { showBootError } from "../ui/notices/boot-error";
import { attachVisualViewport, PHONE_INPUT_BOTTOM_PX } from "../ui/phone/phone-viewport";
import { createSurfaces } from "../ui/surfaces/surfaces";

const log = createLogger("phone-bootstrap");

async function bootstrap(): Promise<{ dispose(): void }> {
  excludeOwnOriginFromCorsFetch();
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const { register, dispose, isDisposed } = createDisposers();
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(dispose);
  }

  app.innerHTML = `
    <div class="yui-phone">
      <div class="yui-root">
        <div class="yui-stage"></div>
      </div>
    </div>
  `;
  const phone = app.querySelector<HTMLDivElement>(".yui-phone")!;
  const root = phone.querySelector<HTMLDivElement>(".yui-root")!;
  const stage = root.querySelector<HTMLDivElement>(".yui-stage")!;

  const settingsStores = createSettingsStores({ locale: getLocale() });
  for (const store of Object.values(settingsStores)) {
    register(() => store.dispose());
  }
  const conversationStores = createConversationStores();
  for (const store of Object.values(conversationStores)) {
    register(() => store.dispose());
  }

  const petConfig = createPetConfig({
    endpointsSettings: settingsStores.endpointsSettings,
    guardrailsSettings: settingsStores.guardrailsSettings,
    chatKeySettings: settingsStores.chatKeySettings,
    sttKeySettings: settingsStores.sttKeySettings,
    ttsKeySettings: settingsStores.ttsKeySettings,
    log,
  });
  const config = petConfig.config;

  const renderer = createRenderer({ mount: stage });
  register(
    wireCamera({
      stage,
      renderer,
      cameraSettings: settingsStores.cameraSettings,
      idleThrottleSettings: settingsStores.idleThrottleSettings,
    }),
  );
  const ambient = createTier1Engine(renderer);
  ambient.start();
  registerRendererAndAmbientDisposal(register, renderer, ambient);

  const voiceInputStatus = createVoiceInputStatus();
  register(() => voiceInputStatus.dispose());

  register(
    attachVisualViewport({
      root: phone,
      viewport: window.visualViewport,
      layoutHeight: () => window.innerHeight,
    }),
  );

  // A single window has no other window to broadcast a selection to.
  const vrm = wireVrmSelection({ renderer, log, broadcastSettings: () => {} });
  register(() => vrm.vrmSelection.dispose());
  const speaker = wireSpeakerSelection({
    getEndpoints: petConfig.getEndpoints,
    getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    log,
    broadcastSettings: () => {},
  });
  register(() => speaker.speakerSelection.dispose());
  register(
    wireVoiceListAutoRefresh({
      subscribe: settingsStores.endpointsSettings.subscribe,
      getEndpoints: petConfig.getEndpoints,
      refresh: speaker.refreshVoiceList,
    }),
  );

  const push = createPushStores({
    getEndpoints: petConfig.getEndpoints,
    getChatKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    register,
  });

  const surfaces = createSurfaces({
    mount: root,
    // The phone draws no tool tell.
    tool: { showTool() {}, finishTool() {}, hideTool() {} },
    keepBubbleUntilDismissed: () => settingsStores.bubblePersistSettings.get().enabled,
    reasoning: push.reasoning,
    persistentInput: true,
  });
  register(() => surfaces.dispose());
  surfaces.setInputAnchor(PHONE_INPUT_BOTTOM_PX);

  const bus = createEventBus({
    onDrop: (env, reason) => log.info("drop", { event_name: env.event_name, reason }),
  });
  const userInput = createUserInputSource(bus);

  try {
    const cfg = await config.load();
    if (isDisposed()) return { dispose };
    surfaces.setAttachmentLimits(cfg.guardrails.attachments);
    const configured = await createPhoneBootstrap(cfg, {
      config,
      renderer,
      surfaces,
      settings: settingsStores,
      conversation: conversationStores,
      bus,
      userInput,
      voiceInputStatus,
      vrm,
      speaker,
      pushSocket: push.pushSocket,
      delegations: push.delegations,
      delegationHistory: push.delegationHistory,
      reasoning: push.reasoning,
      getEndpoints: petConfig.getEndpoints,
      getGuardrails: petConfig.getGuardrails,
      isDisposed,
    });
    register(configured.dispose);
    if (isDisposed()) return { dispose };
    push.bind({ vocabulary: configured.broker.vocabulary, stopTurn: configured.stopTurn });
    register(
      wirePushMode({
        socket: push.pushSocket,
        // The phone mounts no delegation chip.
        chip: { create() {}, dispose() {} },
        getEndpoints: petConfig.getEndpoints,
        endpointsSettings: settingsStores.endpointsSettings,
        chatKeySettings: settingsStores.chatKeySettings,
      }),
    );
  } catch (err) {
    if (isDisposed()) return { dispose };
    log.error("config_or_vrm_load_failed", { error: String(err) });
    if (!isDisposed()) showBootError(root, err);
  }
  return { dispose };
}

void bootstrap();
