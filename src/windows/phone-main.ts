/**
 * Phone bootstrap — phone.html entry point, the Android window.
 *
 * Graph: stores + config → createStageRenderer (renderer, camera, Tier 1) → stage backdrop → top row (plate, chip,
 * pill) → createSurfaces (persistent composer, plate-wrapped) → push stores → visibility port
 *   → config.load() → wirePhoneStage (fit band, touch camera, tap)
 *   → createPhoneBootstrap (turn core) → wirePushMode (socket, suspended by visibility).
 * The root follows the visual viewport, so the soft keyboard shortens the stage.
 */

import "../styles.css";
import "../ui/phone/phone.css";
import { createDisposers } from "../app/disposers";
import { createPhoneBootstrap } from "../app/phone/bootstrap-phone";
import { pushOnlyEndpoints } from "../app/phone/endpoints/push-only";
import { createPhoneSettings } from "../app/phone/settings/wire-phone-settings";
import { wirePhoneStage } from "../app/phone/stage/wire-phone-stage";
import { createPhoneTopRow } from "../app/phone/top-row/create-phone-top-row";
import { createWindowStores } from "../app/settings/window-stores";
import { wireAvatarSelection } from "../app/settings/wire-avatar";
import { createPetConfig } from "../app/settings/wire-config";
import { createStageRenderer } from "../app/stage/stage-renderer";
import { createPushStores } from "../app/turn/push-stores";
import { wirePushMode } from "../app/turn/wire-push";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../config/load";
import { createEventBus } from "../dispatcher/core/event-bus";
import { createUserInputSource } from "../dispatcher/sources/user-input-source";
import { createStageBackground } from "../io/assets/stage/stage-background";
import { importStageImage } from "../io/assets/stage/stage-image-import";
import { removeUserVrm } from "../io/assets/vrm-import";
import { watchPageVisibility } from "../io/lifecycle/page-visibility";
import { excludeOwnOriginFromCorsFetch } from "../io/window/own-origin-fetch";
import { createLogger, initLogger } from "../logger";
import { createVoiceInputStatus } from "../ui/chips/voice-input-status";
import { withPlate } from "../ui/message/plate-surfaces";
import { showBootError } from "../ui/notices/boot-error";
import { attachVisualViewport, PHONE_INPUT_BOTTOM_PX } from "../ui/phone/phone-viewport";
import { createStageBackdrop } from "../ui/phone/stage/stage-backdrop";
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

  const { settingsStores, conversationStores } = createWindowStores(register);
  const petConfig = createPetConfig({ ...settingsStores, log });
  // The phone speaks the push transport only; every reader sees chat_api push.
  const getEndpoints = pushOnlyEndpoints(petConfig.getEndpoints);
  const config = petConfig.config;
  // The turn stopper arrives with the configured bootstrap; the view can open before then,
  // and "Start fresh" before a turn core exists has nothing in flight to stop.
  let stopTurn: () => void = () => {};
  const { renderer } = createStageRenderer({ stage, settings: settingsStores, register });

  // Read before any await so the initial hidden state is known at startup.
  const visibility = watchPageVisibility(document);
  register(() => visibility.dispose());

  const voiceInputStatus = createVoiceInputStatus();
  register(() => voiceInputStatus.dispose());

  register(
    attachVisualViewport({
      root: phone,
      viewport: window.visualViewport,
      layoutHeight: () => window.innerHeight,
    }),
  );

  const { vrm, speaker } = wireAvatarSelection({
    renderer,
    getEndpoints,
    getTtsKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    endpointsSettings: settingsStores.endpointsSettings,
    log,
    // A single window has no other window to broadcast a selection to.
    broadcastSettings: () => {},
    register,
  });

  const push = createPushStores({
    getEndpoints,
    getChatKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
    register,
  });

  const stageBackground = createStageBackground();
  register(stageBackground.dispose);
  register(createStageBackdrop({ root: phone, store: stageBackground, log }).dispose);

  // The settings/history view the top row and the chip's lost-state tap open.
  const phoneSettings = createPhoneSettings({
    mount: phone,
    stores: settingsStores,
    vrm,
    removeUserVrm,
    stageBackground,
    importStageImage: () => importStageImage(stageBackground),
    conversation: conversationStores,
    pushSocket: push.pushSocket,
    stopTurn: () => stopTurn(),
    getEndpoints,
    config,
  });
  register(phoneSettings.dispose);

  const topRow = createPhoneTopRow({
    mount: root,
    voice: voiceInputStatus,
    pushSocket: push.pushSocket,
    delegations: push.delegations,
    onOpenView: (tab) => phoneSettings.open(tab),
  });
  register(topRow.dispose);

  const surfaces = createSurfaces({
    mount: root,
    tool: topRow.tool,
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
    register(
      wirePhoneStage({ stage, renderer, cfg, bus, cameraSettings: settingsStores.cameraSettings }),
    );
    surfaces.setAttachmentLimits(cfg.guardrails.attachments);
    const plateSurfaces = withPlate(surfaces, topRow.plate);
    const configured = await createPhoneBootstrap(cfg, {
      config,
      renderer,
      surfaces: plateSurfaces,
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
      getEndpoints,
      getGuardrails: petConfig.getGuardrails,
      isDisposed,
    });
    register(configured.dispose);
    stopTurn = configured.stopTurn;
    if (isDisposed()) return { dispose };
    push.bind({ vocabulary: configured.broker.vocabulary, stopTurn: configured.stopTurn });
    register(
      wirePushMode({
        socket: push.pushSocket,
        chip: topRow.chip,
        getEndpoints,
        endpointsSettings: settingsStores.endpointsSettings,
        chatKeySettings: settingsStores.chatKeySettings,
        suspended: visibility,
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
