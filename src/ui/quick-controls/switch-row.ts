import type { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type { ScreenKnobSettingsStore } from "../../settings/capture/screen-settings";
import type { MessageWindowSettingsStore } from "../../settings/panels/message-window-settings";
import type { FlagSettingsStore } from "../../settings/persisted-store";
import type { createFillerSettings } from "../../settings/voice/filler-settings";
import type { createVadSettings } from "../../settings/voice/vad-settings";
import { isTauri } from "../../tauri-env";
import { SCREEN_WATCH_SVG } from "./constants";

export interface SwitchRow {
  selector: `.${string}`;
  labelKey: string;
  subKey?: string;
  ariaKey: string;
  tab: "talk" | "input" | "react" | "advanced";
  position?: "after-vad" | "filler" | "screen";
  accessory?: "agent-port";
  labelIcon?: string;
  isVisible: boolean;
  isAvailable: boolean;
  initialEnabled: boolean;
  getEnabled: () => boolean;
  setEnabled: (value: boolean) => void;
  logKey?: string;
}

type VadSettingsStore = ReturnType<typeof createVadSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type FillerSettingsStore = ReturnType<typeof createFillerSettings>;

interface SwitchRowOptions {
  idleThrottleSettings: FlagSettingsStore;
  ttsSettings?: FlagSettingsStore;
  vad: VadSettingsStore;
  gazeSettings?: FlagSettingsStore;
  climbSettings?: FlagSettingsStore;
  fallSettings?: FlagSettingsStore;
  agentNotifySettings?: AgentNotifySettingsStore;
  fillerSettings?: FillerSettingsStore;
  bubblePersistSettings?: FlagSettingsStore;
  messageWindowSettings?: MessageWindowSettingsStore;
  screenSettings?: FlagSettingsStore;
  screenKnobSettings?: ScreenKnobSettingsStore;
}

export function createSwitchRows({
  idleThrottleSettings,
  ttsSettings,
  vad,
  gazeSettings,
  climbSettings,
  fallSettings,
  agentNotifySettings,
  fillerSettings,
  bubblePersistSettings,
  messageWindowSettings,
  screenSettings,
  screenKnobSettings,
}: SwitchRowOptions): SwitchRow[] {
  return [
    {
      selector: ".yui-screen-switch",
      labelKey: "screen.label",
      subKey: "screen.sub",
      ariaKey: "screen.aria",
      tab: "react",
      position: "screen",
      labelIcon: SCREEN_WATCH_SVG,
      // Paired with the knob store: a toggle whose thresholds cannot be edited is a dead half-section.
      isVisible: !!screenSettings && !!screenKnobSettings,
      isAvailable: !!screenSettings && !!screenKnobSettings,
      initialEnabled: screenSettings?.get().enabled ?? false,
      getEnabled: () => screenSettings!.get().enabled,
      setEnabled: (v) => screenSettings!.setEnabled(v),
      logKey: "screen_watch_toggle",
    },
    {
      selector: ".yui-idle-throttle-switch",
      labelKey: "perf.idle_label",
      subKey: "perf.idle_sub",
      ariaKey: "perf.idle_aria",
      tab: "advanced",
      isVisible: true,
      isAvailable: true,
      initialEnabled: false,
      getEnabled: () => idleThrottleSettings.get().enabled,
      setEnabled: (v) => idleThrottleSettings.setEnabled(v),
      logKey: "idle_throttle_toggle",
    },
    {
      selector: ".yui-tts-switch",
      labelKey: "tts_output.label",
      subKey: "tts_output.sub",
      ariaKey: "tts_output.aria",
      tab: "input",
      labelIcon: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
  <path d="M9 10l2.5 2.5L15 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 9h2M18 9h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`,
      isVisible: true,
      isAvailable: !!ttsSettings,
      initialEnabled: ttsSettings?.get().enabled ?? true,
      getEnabled: () => ttsSettings!.get().enabled,
      setEnabled: (v) => ttsSettings!.setEnabled(v),
      logKey: "tts_output_toggle",
    },
    {
      selector: ".yui-bargein-switch",
      labelKey: "voice_input.bargein_label",
      ariaKey: "voice_input.bargein_aria",
      tab: "input",
      position: "after-vad",
      isVisible: true,
      isAvailable: true,
      initialEnabled: vad.get().bargeIn,
      getEnabled: () => vad.get().bargeIn,
      setEnabled: (v) => vad.setBargeIn(v),
      logKey: "bargein_toggle",
    },
    {
      selector: ".yui-bubble-persist-switch",
      labelKey: "bubble_persist.label",
      subKey: "bubble_persist.sub",
      ariaKey: "bubble_persist.aria",
      tab: "input",
      position: "after-vad",
      isVisible: !!bubblePersistSettings,
      isAvailable: !!bubblePersistSettings,
      initialEnabled: bubblePersistSettings?.get().enabled ?? false,
      getEnabled: () => bubblePersistSettings!.get().enabled,
      setEnabled: (v) => bubblePersistSettings!.setEnabled(v),
      logKey: "bubble_persist_toggle",
    },
    {
      selector: ".yui-message-window-switch",
      labelKey: "message_window.label",
      subKey: "message_window.sub",
      ariaKey: "message_window.aria",
      tab: "input",
      position: "after-vad",
      // The browser dev build has one window, so there is nothing to pop the surfaces into.
      isVisible: !!messageWindowSettings && isTauri(),
      isAvailable: !!messageWindowSettings && isTauri(),
      initialEnabled: messageWindowSettings?.get().mode === "popped",
      getEnabled: () => messageWindowSettings!.get().mode === "popped",
      setEnabled: (v) => messageWindowSettings!.setMode(v ? "popped" : "docked"),
      logKey: "message_window_toggle",
    },
    {
      selector: ".yui-gaze-switch",
      labelKey: "gaze.label",
      subKey: "gaze.sub",
      ariaKey: "gaze.aria",
      tab: "advanced",
      isVisible: !!gazeSettings,
      isAvailable: !!gazeSettings,
      initialEnabled: gazeSettings?.get().enabled ?? false,
      getEnabled: () => gazeSettings!.get().enabled,
      setEnabled: (v) => gazeSettings!.setEnabled(v),
      logKey: "gaze_toggle",
    },
    {
      selector: ".yui-climb-switch",
      labelKey: "climb.label",
      subKey: "climb.sub",
      ariaKey: "climb.aria",
      tab: "advanced",
      isVisible: !!climbSettings,
      isAvailable: !!climbSettings,
      initialEnabled: climbSettings?.get().enabled ?? true,
      getEnabled: () => climbSettings!.get().enabled,
      setEnabled: (v) => climbSettings!.setEnabled(v),
      logKey: "climb_toggle",
    },
    {
      selector: ".yui-fall-switch",
      labelKey: "fall.label",
      subKey: "fall.sub",
      ariaKey: "fall.aria",
      tab: "advanced",
      isVisible: !!fallSettings,
      isAvailable: !!fallSettings,
      initialEnabled: fallSettings?.get().enabled ?? true,
      getEnabled: () => fallSettings!.get().enabled,
      setEnabled: (v) => fallSettings!.setEnabled(v),
      logKey: "fall_toggle",
    },
    {
      selector: ".yui-agentnotify-switch",
      labelKey: "agentNotify.label",
      subKey: "agentNotify.sub",
      ariaKey: "agentNotify.aria",
      tab: "react",
      accessory: "agent-port",
      isVisible: !!agentNotifySettings,
      isAvailable: !!agentNotifySettings,
      initialEnabled: agentNotifySettings?.get().enabled ?? false,
      getEnabled: () => agentNotifySettings!.get().enabled,
      setEnabled: (v) => agentNotifySettings!.setEnabled(v),
      logKey: "agent_notify_toggle",
    },
    {
      selector: ".yui-filler-switch",
      labelKey: "filler.enable_label",
      subKey: "filler.enable_sub",
      ariaKey: "filler.enable_label",
      tab: "talk",
      position: "filler",
      isVisible: !!fillerSettings,
      isAvailable: !!fillerSettings,
      initialEnabled: false,
      getEnabled: () => fillerSettings!.get().enabled,
      setEnabled: (v) => fillerSettings!.setEnabled(v),
    },
  ];
}
