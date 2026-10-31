import type { ScreenConfig } from "../../config/validators/screen";
import type { SignalGroup } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import {
  composePacedPipelineBusy,
  type PacedPipelineBusy,
} from "../../dispatcher/core/paced-pipeline-busy";
import type { ProactivePacer } from "../../dispatcher/core/proactive-pacer";
import {
  type AddressedSource,
  createAddressedSource,
} from "../../dispatcher/sources/addressed/addressed-source";
import {
  createMilestoneSource,
  type MilestoneSource,
} from "../../dispatcher/sources/idle-tick/milestone-source";
import {
  createProactiveSource,
  type ProactiveSource,
} from "../../dispatcher/sources/idle-tick/proactive-source";
import {
  createScheduleSource,
  type ScheduleSource,
} from "../../dispatcher/sources/idle-tick/schedule-source";
import {
  createScreenSource,
  type ScreenSource,
} from "../../dispatcher/sources/idle-tick/screen-source";
import {
  createSignalsSource,
  type SignalsSource,
} from "../../dispatcher/sources/inbox/signals-source";
import { createRoutedUserSource } from "../../dispatcher/sources/routed/routed-user-source";
import type { UserInputSource } from "../../dispatcher/sources/user-input-source";
import type { CharacterAddressed, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { appendRecord } from "../../io/chat/record/turn-record-log";
import type { AgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type { ProactiveSettings } from "../../settings/cues/proactive-settings";
import type { ScheduleSettings } from "../../settings/cues/schedule-settings";
import type { ClampedIntSettingsStore } from "../../settings/persisted-store";

/**
 * tier2 utterance candidate sources: proactive.<id> (idle dramatization) + schedule.<id>
 * (time-of-day greeting) + signals.batch/catchup/urgent/urgent_catchup +
 * time_milestone.first_activity (first present tick of the local day), all over the
 * presence gate.
 * Created and started; the started refs are returned for interaction-notes and teardown.
 */
export function wireDispatcherSources(deps: {
  bus: EventBus;
  presenceSettings: Pick<ClampedIntSettingsStore, "get">;
  proactiveSettings: { get(): ProactiveSettings };
  scheduleSettings: { get(): ScheduleSettings };
  agentNotifySettings: { get(): AgentNotifySettings };
  screenSettings: { get(): { enabled: boolean } };
  getScreenConfig: () => ScreenConfig;
  /** Dispatcher in-flight busy edges — anchors the screen source's quiet-after-turn window. */
  subscribeBusy: (cb: (busy: boolean) => void) => () => void;
  pipelineBusy: PacedPipelineBusy;
  /** Global proactive gap — a hold reads as a skip to the screen source and as busy to the inboxes. */
  pacer: Pick<ProactivePacer, "isHolding" | "subscribe">;
  /** Subscribes to the character-addressed bridge events this preset is named in. */
  onCharacterAddressed: (cb: (event: CharacterAddressed) => void) => () => void;
  /** Subscribes to the unified chat window's messages routed to this preset. */
  onUserTurnRouted: (cb: (event: UserTurnRouted) => void) => () => void;
  /** Where a routed message enters as a user turn. */
  submitUser: UserInputSource["submit"];
  /** This window's preset id — the addressed and routed sources keep only events naming it. */
  selfPresetId: string;
  /** Called with each parsed signal group as it arrives. */
  onSignalArrival?: (group: SignalGroup) => void;
}): {
  proactiveSource: ProactiveSource;
  scheduleSource: ScheduleSource;
  signalsSource: SignalsSource;
  milestoneSource: MilestoneSource;
  screenSource: ScreenSource;
  addressedSource: AddressedSource;
  routedUserSource: ReturnType<typeof createRoutedUserSource>;
} {
  const {
    bus,
    presenceSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    screenSettings,
    getScreenConfig,
    subscribeBusy,
    pipelineBusy,
    pacer,
  } = deps;
  const pacedPipelineBusy = composePacedPipelineBusy({ pipelineBusy, pacer });
  const proactiveSource = createProactiveSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getCues: () => proactiveSettings.get().entries,
    isEnabled: () => proactiveSettings.get().enabled,
  });
  void proactiveSource.start();
  const scheduleSource = createScheduleSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getCues: () => scheduleSettings.get().entries,
    isEnabled: () => scheduleSettings.get().enabled,
  });
  void scheduleSource.start();
  const signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
    isUrgentPipelineBusy: pipelineBusy.isBusy,
    subscribeUrgentPipelineBusy: pipelineBusy.subscribe,
    onArrival: deps.onSignalArrival,
  });
  void signalsSource.start();
  const milestoneSource = createMilestoneSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => scheduleSettings.get().enabled,
    drainSignals: () => signalsSource.drain(),
  });
  void milestoneSource.start();
  const screenSource = createScreenSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    getConfig: getScreenConfig,
    isEnabled: () => screenSettings.get().enabled,
    noteInteraction: proactiveSource.noteInteraction,
    subscribeBusy,
    isPacerHolding: pacer.isHolding,
    appendSkipRecord: (record) => appendRecord(record),
  });
  void screenSource.start();
  const addressedSource = createAddressedSource({
    bus,
    selfPresetId: deps.selfPresetId,
    subscribe: deps.onCharacterAddressed,
  });
  addressedSource.start();
  const routedUserSource = createRoutedUserSource({
    selfPresetId: deps.selfPresetId,
    subscribe: deps.onUserTurnRouted,
    submit: deps.submitUser,
  });
  routedUserSource.start();
  return {
    proactiveSource,
    scheduleSource,
    signalsSource,
    milestoneSource,
    screenSource,
    addressedSource,
    routedUserSource,
  };
}
