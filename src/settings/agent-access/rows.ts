import type { FillerLang } from "../../config/validators/filler";
import { createActiveHoursSettings } from "../active-hours/active-hours-settings";
import { type BasePace, createBasePaceSettings } from "../active-hours/base-pace-settings";
import type { Span } from "../active-hours/spans";
import { createTextSizeSettings, type TextSize } from "../appearance/text-size-settings";
import { createThemeSettings, type Theme } from "../appearance/theme-settings";
import { createExpressMotionSettings } from "../avatar/express-motion-settings";
import { createIdleMotionSettings } from "../avatar/idle-motion-settings";
import { createLipsyncSettings } from "../avatar/lipsync-settings";
import { createAgentNotifySettings } from "../backend/agent-notify-settings";
import { createAgentSettings, type ReasoningEffort } from "../backend/agent-settings";
import { createGuardrailsSettings } from "../backend/guardrails-settings";
import { createScreenKnobSettings } from "../capture/screen-settings";
import { createScreenshotSettings } from "../capture/screenshot-settings";
import { createUserNameSettings } from "../identity/user-name-settings";
import { createFlagSettings, type PersistedStorage } from "../persisted-store";
import { createRelationsSwitch } from "../relations/relations-switch";
import { createPacerGapStore, type SettingsStores } from "../settings-stores";
import {
  createThreadReactionThresholdsSettings,
  type ReactionCount,
  type ReactionWait,
} from "../threads/thread-reaction-thresholds-settings";
import { createThreadTurnsSettings, type ThreadTurnsLevel } from "../threads/thread-turns-settings";
import { createUnifiedChatSwitch } from "../unified/unified-chat-switch";
import { createFillerSettings } from "../voice/filler-settings";
import { createReadingsSettings } from "../voice/readings-settings";
import { createVadSettings } from "../voice/vad-settings";
import { getIn } from "./paths";

export type SettingScope = "char" | "global";
export type SettingTier = "direct" | "allow";

interface StoreGetter {
  get(): unknown;
}

/** One exposed setting: a scalar leaf of the settings document. */
export interface SettingRow {
  path: string;
  store: keyof SettingsStores;
  /** Path of the leaf inside its store's value. */
  field: readonly string[];
  /** The store field's value for a document value, when the two differ. */
  toField?(value: unknown): unknown;
  scope: SettingScope;
  tier: SettingTier;
  labelKey: string;
  /** True when a null clears the row instead of invalidating it. */
  nullable?: boolean;
  read(stores: SettingsStores): unknown;
  write(stores: SettingsStores, value: unknown): void;
  factory(storage: PersistedStorage<any>): StoreGetter;
  /** Label key of each enum value, as the settings window names it. */
  valueLabels?: Readonly<Record<string, string>>;
  /** The settings window's display unit: the stored value divided by `per`, then the `suffixKey` text (`oneKey` for exactly 1). */
  unit?: { per: number; suffixKey: string; oneKey?: string };
  /** True when a stored 0 means YUI's default rather than zero. */
  zeroIsDefault?: boolean;
  /** Label key naming a 0-based index as the settings window does, `{n}` its 1-based number. */
  ordinalKey?: string;
  /** Label key for a null value, where null names something other than "none". */
  nullKey?: string;
}

type RowSpec = Omit<SettingRow, "read"> & Partial<Pick<SettingRow, "read">>;

const row = (spec: RowSpec): SettingRow => ({
  read: (stores) => getIn(stores[spec.store].get(), spec.field),
  ...spec,
});

export const ROWS: readonly SettingRow[] = [
  row({
    path: "voice.output",
    store: "ttsSettings",
    field: ["enabled"],
    scope: "char",
    tier: "direct",
    labelKey: "tts_output.label",
    write: (stores, value) => stores.ttsSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "voice.one_at_a_time",
    store: "oneVoiceSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "one_voice.label",
    write: (stores, value) => stores.oneVoiceSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "voice.filler.enabled",
    store: "fillerSettings",
    field: ["enabled"],
    scope: "char",
    tier: "direct",
    labelKey: "filler.enable_label",
    write: (stores, value) => stores.fillerSettings.setEnabled(value as boolean),
    factory: (storage) => createFillerSettings({ storage }),
  }),
  row({
    path: "voice.filler.language",
    store: "fillerSettings",
    field: ["language"],
    scope: "char",
    tier: "direct",
    labelKey: "filler.lang_label",
    write: (stores, value) => stores.fillerSettings.setLanguage(value as FillerLang),
    factory: (storage) => createFillerSettings({ storage }),
  }),
  row({
    path: "voice.readings",
    store: "readingsSettings",
    field: ["text"],
    scope: "global",
    tier: "direct",
    labelKey: "reading.section",
    write: (stores, value) => stores.readingsSettings.setText(value as string),
    factory: (storage) => createReadingsSettings({ storage }),
  }),
  row({
    path: "voice_input.silence_ms",
    store: "vadSettings",
    field: ["silenceMs"],
    scope: "global",
    tier: "direct",
    labelKey: "voice_input.silence_label",
    write: (stores, value) => stores.vadSettings.setSilenceMs(value as number),
    factory: (storage) => createVadSettings({ storage }),
  }),
  row({
    path: "voice_input.barge_in",
    store: "vadSettings",
    field: ["bargeIn"],
    scope: "global",
    tier: "direct",
    labelKey: "voice_input.bargein_label",
    write: (stores, value) => stores.vadSettings.setBargeIn(value as boolean),
    factory: (storage) => createVadSettings({ storage }),
  }),
  row({
    path: "character.reasoning_effort",
    store: "agentSettings",
    field: ["reasoning_effort"],
    scope: "char",
    tier: "direct",
    labelKey: "reasoning.label",
    write: (stores, value) => stores.agentSettings.setReasoningEffort(value as ReasoningEffort),
    factory: (storage) => createAgentSettings({ storage }),
  }),
  row({
    path: "character.active_hours",
    store: "activeHoursSettings",
    field: ["spans"],
    scope: "char",
    tier: "direct",
    labelKey: "active_hours.label",
    nullable: true,
    write: (stores, value) =>
      value === null
        ? stores.activeHoursSettings.reset()
        : stores.activeHoursSettings.setSpans(value as Span[]),
    factory: (storage) => createActiveHoursSettings({ storage }),
  }),
  row({
    path: "user.name",
    store: "userNameSettings",
    field: ["name"],
    scope: "global",
    tier: "direct",
    labelKey: "card.user_name",
    write: (stores, value) => stores.userNameSettings.setName(value as string),
    factory: (storage) => createUserNameSettings({ storage }),
  }),
  row({
    path: "appearance.theme",
    store: "themeSettings",
    field: ["theme"],
    scope: "global",
    tier: "direct",
    labelKey: "appearance.label",
    write: (stores, value) => stores.themeSettings.setTheme(value as Theme),
    factory: (storage) => createThemeSettings({ storage }),
  }),
  row({
    path: "appearance.text_size",
    store: "textSizeSettings",
    field: ["scale"],
    scope: "global",
    tier: "direct",
    labelKey: "textsize.label",
    write: (stores, value) => stores.textSizeSettings.setScale(value as TextSize),
    factory: (storage) => createTextSizeSettings({ storage }),
  }),
  row({
    path: "bubble.keep",
    store: "bubblePersistSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "bubble_persist.label",
    write: (stores, value) => stores.bubblePersistSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(false, { storage }),
  }),
  row({
    path: "body.gaze",
    store: "gazeSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "gaze.label",
    write: (stores, value) => stores.gazeSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "body.climb",
    store: "climbSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "climb.label",
    write: (stores, value) => stores.climbSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "body.fall",
    store: "fallSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "fall.label",
    write: (stores, value) => stores.fallSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "body.mouth_gain",
    store: "lipsyncSettings",
    field: ["gain"],
    scope: "global",
    tier: "direct",
    labelKey: "expression.mouth_label",
    write: (stores, value) => stores.lipsyncSettings.setGain(value as number),
    factory: (storage) => createLipsyncSettings({ storage }),
  }),
  row({
    path: "motions.idle_disabled",
    store: "idleMotionSettings",
    field: ["disabled"],
    scope: "global",
    tier: "direct",
    labelKey: "idle_motion.section",
    write: (stores, value) => {
      const next = value as string[];
      const current = stores.idleMotionSettings.get().disabled;
      for (const path of next)
        if (!current.includes(path)) {
          stores.idleMotionSettings.setEnabled(path, false);
        }
      for (const path of current)
        if (!next.includes(path)) {
          stores.idleMotionSettings.setEnabled(path, true);
        }
    },
    factory: (storage) => createIdleMotionSettings({ storage }),
  }),
  row({
    path: "motions.express_disabled",
    store: "expressMotionSettings",
    field: ["disabled"],
    scope: "global",
    tier: "direct",
    labelKey: "express_motion.section",
    write: (stores, value) => {
      const next = value as string[];
      const current = stores.expressMotionSettings.get().disabled;
      for (const id of next)
        if (!current.includes(id)) {
          stores.expressMotionSettings.setEnabled(id, false);
        }
      for (const id of current)
        if (!next.includes(id)) {
          stores.expressMotionSettings.setEnabled(id, true);
        }
    },
    factory: (storage) => createExpressMotionSettings({ storage }),
  }),
  row({
    path: "pace.base",
    store: "basePaceSettings",
    field: ["pace"],
    scope: "global",
    tier: "direct",
    labelKey: "base_pace.title",
    write: (stores, value) => stores.basePaceSettings.setPace(value as BasePace),
    factory: (storage) => createBasePaceSettings({ storage }),
  }),
  row({
    path: "threads.reactions",
    store: "threadReactionsSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "threadReactions.label",
    write: (stores, value) => stores.threadReactionsSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "threads.reaction_count",
    store: "threadReactionThresholdsSettings",
    field: ["count"],
    scope: "global",
    tier: "direct",
    labelKey: "threadReactionThresholds.count_label",
    write: (stores, value) =>
      stores.threadReactionThresholdsSettings.setCount(value as ReactionCount),
    factory: (storage) => createThreadReactionThresholdsSettings({ storage }),
  }),
  row({
    path: "threads.reaction_wait_min",
    store: "threadReactionThresholdsSettings",
    field: ["wait_min"],
    scope: "global",
    tier: "direct",
    labelKey: "threadReactionThresholds.wait_label",
    write: (stores, value) =>
      stores.threadReactionThresholdsSettings.setWait(value as ReactionWait),
    factory: (storage) => createThreadReactionThresholdsSettings({ storage }),
  }),
  row({
    path: "relations.enabled",
    store: "relationsSwitch",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "relations.section",
    write: (stores, value) => stores.relationsSwitch.setEnabled(value as boolean),
    factory: (storage) => createRelationsSwitch(storage),
  }),
  row({
    path: "unified_chat",
    store: "unifiedChatSwitch",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "unified.enable_label",
    write: (stores, value) => stores.unifiedChatSwitch.setEnabled(value as boolean),
    factory: (storage) => createUnifiedChatSwitch(storage),
  }),
  row({
    path: "performance.idle_throttle",
    store: "idleThrottleSettings",
    field: ["enabled"],
    scope: "global",
    tier: "direct",
    labelKey: "perf.idle_label",
    write: (stores, value) => stores.idleThrottleSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "pace.rest",
    store: "dndSettings",
    field: ["enabled"],
    scope: "global",
    tier: "allow",
    labelKey: "character_menu.rest",
    write: (stores, value) => stores.dndSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(false, { storage }),
  }),
  row({
    path: "privacy.screenshot",
    store: "screenshotSettings",
    field: ["enabled"],
    scope: "global",
    tier: "allow",
    labelKey: "screenshot.label",
    write: (stores, value) => stores.screenshotSettings.setEnabled(value as boolean),
    factory: (storage) => createScreenshotSettings({ storage }),
  }),
  row({
    path: "privacy.screen_requests",
    store: "screenshotSettings",
    field: ["allowRequests"],
    scope: "global",
    tier: "allow",
    labelKey: "screenshot.request_label",
    write: (stores, value) => stores.screenshotSettings.setAllowRequests(value as boolean),
    factory: (storage) => createScreenshotSettings({ storage }),
  }),
  row({
    path: "privacy.screen_display",
    store: "screenshotSettings",
    field: ["source"],
    scope: "global",
    tier: "allow",
    labelKey: "screenshot.source_label",
    toField: (index) => ({ kind: "monitor", index }),
    // A window or browser tab source names no display.
    read: (stores) => {
      const { source } = stores.screenshotSettings.get();
      return source.kind === "monitor" ? source.index : null;
    },
    write: (stores, value) =>
      stores.screenshotSettings.setSource({ kind: "monitor", index: value as number }),
    ordinalKey: "screenshot.display",
    nullKey: "settings_request.not_display",
    factory: (storage) => createScreenshotSettings({ storage }),
  }),
  row({
    path: "privacy.screen_watch.enabled",
    store: "screenSettings",
    field: ["enabled"],
    scope: "global",
    tier: "allow",
    labelKey: "screen.label",
    write: (stores, value) => stores.screenSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(false, { storage }),
  }),
  row({
    path: "privacy.screen_watch.prev_dwell_ms",
    store: "screenKnobSettings",
    field: ["prev_dwell_ms"],
    scope: "global",
    tier: "allow",
    labelKey: "screen.prev_dwell_label",
    write: (stores, value) => stores.screenKnobSettings.set({ prev_dwell_ms: value as number }),
    unit: { per: 60_000, suffixKey: "screen.minutes_suffix" },
    zeroIsDefault: true,
    factory: (storage) => createScreenKnobSettings({ storage }),
  }),
  row({
    path: "privacy.screen_watch.settle_ms",
    store: "screenKnobSettings",
    field: ["settle_ms"],
    scope: "global",
    tier: "allow",
    labelKey: "screen.settle_label",
    write: (stores, value) => stores.screenKnobSettings.set({ settle_ms: value as number }),
    unit: { per: 1_000, suffixKey: "screen.seconds_suffix" },
    zeroIsDefault: true,
    factory: (storage) => createScreenKnobSettings({ storage }),
  }),
  row({
    path: "privacy.screen_watch.long_session_ms",
    store: "screenKnobSettings",
    field: ["long_session_ms"],
    scope: "global",
    tier: "allow",
    labelKey: "screen.long_session_label",
    write: (stores, value) => stores.screenKnobSettings.set({ long_session_ms: value as number }),
    unit: { per: 60_000, suffixKey: "screen.minutes_suffix" },
    zeroIsDefault: true,
    factory: (storage) => createScreenKnobSettings({ storage }),
  }),
  row({
    path: "privacy.screen_watch.recent_cap",
    store: "screenKnobSettings",
    field: ["recent_cap"],
    scope: "global",
    tier: "allow",
    labelKey: "screen.recent_cap_label",
    write: (stores, value) => stores.screenKnobSettings.set({ recent_cap: value as number }),
    unit: { per: 1, suffixKey: "screen.count_suffix", oneKey: "settings_request.entry" },
    zeroIsDefault: true,
    factory: (storage) => createScreenKnobSettings({ storage }),
  }),
  row({
    path: "privacy.external_signals",
    store: "agentNotifySettings",
    field: ["enabled"],
    scope: "global",
    tier: "allow",
    labelKey: "agentNotify.label",
    write: (stores, value) => stores.agentNotifySettings.setEnabled(value as boolean),
    factory: (storage) => createAgentNotifySettings({ storage }),
  }),
  row({
    path: "privacy.thread_turns",
    store: "threadTurnsSettings",
    field: ["level"],
    scope: "global",
    tier: "allow",
    labelKey: "threadTurns.label",
    write: (stores, value) => stores.threadTurnsSettings.setLevel(value as ThreadTurnsLevel),
    valueLabels: {
      off: "threadTurns.off",
      notable: "threadTurns.notable",
      every: "threadTurns.every",
    },
    factory: (storage) => createThreadTurnsSettings({ storage }),
  }),
  row({
    path: "limits.tier2_max",
    store: "guardrailsSettings",
    field: ["tier2_max"],
    scope: "global",
    tier: "allow",
    labelKey: "reactions.rate_tier2_label",
    write: (stores, value) => stores.guardrailsSettings.set({ tier2_max: value as number }),
    zeroIsDefault: true,
    factory: (storage) => createGuardrailsSettings({ storage }),
  }),
  row({
    path: "limits.urgent_max",
    store: "guardrailsSettings",
    field: ["urgent_max"],
    scope: "global",
    tier: "allow",
    labelKey: "reactions.rate_urgent_label",
    write: (stores, value) => stores.guardrailsSettings.set({ urgent_max: value as number }),
    zeroIsDefault: true,
    factory: (storage) => createGuardrailsSettings({ storage }),
  }),
  row({
    path: "limits.addressed_chain_max",
    store: "guardrailsSettings",
    field: ["addressed_chain_max"],
    scope: "global",
    tier: "allow",
    labelKey: "reactions.rate_addressed_label",
    write: (stores, value) =>
      stores.guardrailsSettings.set({ addressed_chain_max: value as number }),
    zeroIsDefault: true,
    factory: (storage) => createGuardrailsSettings({ storage }),
  }),
  row({
    path: "limits.proactive_gap_ms",
    store: "pacerGapSettings",
    field: ["value"],
    scope: "global",
    tier: "allow",
    labelKey: "reactions.pacer_gap_label",
    write: (stores, value) => stores.pacerGapSettings.set(value as number),
    unit: { per: 60_000, suffixKey: "reactions.minutes_suffix" },
    factory: (storage) => createPacerGapStore(storage),
  }),
];
