import type { ScreenConfig } from "../../config/validators/screen";
import type { EventBus } from "../../dispatcher/core/event-bus";
import {
  composePacedPipelineBusy,
  type PacedPipelineBusy,
} from "../../dispatcher/core/paced-pipeline-busy";
import type { ProactivePacer } from "../../dispatcher/core/proactive-pacer";
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
import { createAgentSource } from "../../dispatcher/sources/inbox/agent-source";
import {
  createSignalsSource,
  type SignalsSource,
} from "../../dispatcher/sources/inbox/signals-source";
import { createWakeSource, type WakeSource } from "../../dispatcher/sources/wake/wake-source";
import { appendRecord } from "../../io/chat/record/turn-record-log";
import type { AgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type { ProactiveSettings } from "../../settings/cues/proactive-settings";
import type { ScheduleSettings } from "../../settings/cues/schedule-settings";
import type { ClampedIntSettingsStore } from "../../settings/persisted-store";

/**
 * tier2 utterance candidate sources: proactive.<id> (idle dramatization) + schedule.<id>
 * (time-of-day greeting) + agent.done/needs_input/catchup + signals.push/batch/catchup +
 * time_milestone.first_activity (first present tick of the local day), all over the
 * presence gate, plus proactive.wake (the character getting out of the bed).
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
  /** True while the day's first-activity candidate waits. */
  isFirstActivityHeld: () => boolean;
}): {
  proactiveSource: ProactiveSource;
  scheduleSource: ScheduleSource;
  agentSource: ReturnType<typeof createAgentSource>;
  signalsSource: SignalsSource;
  milestoneSource: MilestoneSource;
  screenSource: ScreenSource;
  wakeSource: WakeSource;
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
  const agentSource = createAgentSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
  });
  void agentSource.start();
  const signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => agentNotifySettings.get().enabled,
    isPipelineBusy: pacedPipelineBusy.isBusy,
    subscribePipelineBusy: pacedPipelineBusy.subscribe,
  });
  void signalsSource.start();
  const milestoneSource = createMilestoneSource({
    bus,
    present_max_idle_ms: presenceSettings.get().value,
    isEnabled: () => scheduleSettings.get().enabled,
    isHeld: deps.isFirstActivityHeld,
    drainSignals: () => signalsSource.drain(),
  });
  void milestoneSource.start();
  const wakeSource = createWakeSource({
    bus,
    firstActivity: milestoneSource,
    drainSignals: () => signalsSource.drain(),
  });
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
  return {
    proactiveSource,
    scheduleSource,
    agentSource,
    signalsSource,
    milestoneSource,
    screenSource,
    wakeSource,
  };
}
