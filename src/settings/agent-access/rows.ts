import type { FillerLang } from "../../config/validators/filler";
import { FILLER_LANGS } from "../../config/validators/filler";
import { createActiveHoursSettings } from "../active-hours/active-hours-settings";
import { type BasePace, createBasePaceSettings } from "../active-hours/base-pace-settings";
import { PACES, type Span } from "../active-hours/spans";
import {
  createTextSizeSettings,
  TEXT_SIZES,
  type TextSize,
} from "../appearance/text-size-settings";
import { createThemeSettings, THEMES, type Theme } from "../appearance/theme-settings";
import {
  createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../avatar/lipsync-settings";
import { createAgentNotifySettings } from "../backend/agent-notify-settings";
import {
  createAgentSettings,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "../backend/agent-settings";
import { createGuardrailsSettings, RATE_LIMIT_MAX } from "../backend/guardrails-settings";
import {
  createScreenKnobSettings,
  SCREEN_MS_MAX,
  SCREEN_RECENT_CAP_MAX,
} from "../capture/screen-settings";
import { createScreenshotSettings } from "../capture/screenshot-settings";
import { createUserNameSettings, MAX_LEN } from "../identity/user-name-settings";
import { createFlagSettings, type PersistedStorage } from "../persisted-store";
import { createRelationsSwitch } from "../relations/relations-switch";
import { createPacerGapStore, PACER_GAP_MAX, type SettingsStores } from "../settings-stores";
import {
  createThreadReactionThresholdsSettings,
  REACTION_COUNTS,
  REACTION_WAITS,
  type ReactionCount,
  type ReactionWait,
} from "../threads/thread-reaction-thresholds-settings";
import { createThreadTurnsSettings, type ThreadTurnsLevel } from "../threads/thread-turns-settings";
import { createUnifiedChatSwitch } from "../unified/unified-chat-switch";
import { createFillerSettings } from "../voice/filler-settings";
import { createReadingsSettings } from "../voice/readings-settings";
import { createVadSettings, VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../voice/vad-settings";
import { getIn } from "./paths";
import { validate } from "./validate";

export type SettingScope = "char" | "global";
export type SettingAccess = "direct" | "allow";

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
  access: SettingAccess;
  labelKey: string;
  /** True when a null clears the row instead of invalidating it. */
  nullable?: boolean;
  read(stores: SettingsStores): unknown;
  /** Applies the value; a row that loads first rejects and leaves the store unchanged. */
  write(stores: SettingsStores, value: unknown): void | Promise<void>;
  /** The row's own acceptance check; table rows probe the store, io rows check their list. */
  valid(stores: SettingsStores, value: unknown): boolean;
  factory(storage: PersistedStorage<any>): StoreGetter;
  /** Label key of each enum value, as the settings window names it. */
  valueLabels?: Readonly<Record<string, string>>;
  /** The settings window's display unit: the stored value divided by `per`, then the `suffixKey` text (`oneKey` for exactly 1). */
  unit?: { per: number; suffixKey: string; oneKey?: string };
  /** True when a stored 0 means YUI's default rather than zero. */
  zeroIsDefault?: boolean;
  /** What a written 0 means, when it is neither zero nor YUI's default. */
  zeroNote?: string;
  /** Label key naming a 0-based index as the settings window does, `{n}` its 1-based number. */
  ordinalKey?: string;
  /** Label key for a null value, where null names something other than "none". */
  nullKey?: string;
  /** The printed type, for rows the store probe cannot infer (complex shapes, io-backed rows). */
  type?: string;
  /** Every value the row accepts, as its store's own vocabulary lists them. */
  values?: readonly (string | number)[];
  /** Inclusive store clamp, printed by help(); the store still does the validation. */
  min?: number;
  max?: number;
  /** True when the store takes whole numbers only. */
  integer?: boolean;
  /** Longest string the row keeps; longer answers invalid. */
  maxLength?: number;
  /** A short hint help() prints after the label. */
  note?: string;
}

type RowSpec = Omit<SettingRow, "read" | "valid"> & Partial<Pick<SettingRow, "read">>;

const row = (spec: RowSpec): SettingRow => ({
  read: (stores) => getIn(stores[spec.store].get(), spec.field),
  valid: (stores, value) => validate(spec, stores, value),
  ...spec,
});

export const union = (values: readonly (string | number)[]): string =>
  values.map((value) => (typeof value === "string" ? `"${value}"` : String(value))).join(" | ");

export const ROWS: readonly SettingRow[] = [
  row({
    path: "voice.output",
    store: "ttsSettings",
    field: ["enabled"],
    scope: "char",
    access: "direct",
    labelKey: "tts_output.label",
    write: (stores, value) => stores.ttsSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "voice.one_at_a_time",
    store: "oneVoiceSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "one_voice.label",
    write: (stores, value) => stores.oneVoiceSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "voice.filler.enabled",
    store: "fillerSettings",
    field: ["enabled"],
    scope: "char",
    access: "direct",
    labelKey: "filler.enable_label",
    write: (stores, value) => stores.fillerSettings.setEnabled(value as boolean),
    factory: (storage) => createFillerSettings({ storage }),
  }),
  row({
    path: "voice.filler.language",
    store: "fillerSettings",
    field: ["language"],
    scope: "char",
    access: "direct",
    labelKey: "filler.lang_label",
    values: FILLER_LANGS,
    write: (stores, value) => stores.fillerSettings.setLanguage(value as FillerLang),
    factory: (storage) => createFillerSettings({ storage }),
  }),
  row({
    path: "voice.readings",
    store: "readingsSettings",
    field: ["text"],
    scope: "global",
    access: "direct",
    labelKey: "reading.section",
    note: "one surface=reading per line",
    maxLength: 16_384,
    write: (stores, value) => stores.readingsSettings.setText(value as string),
    factory: (storage) => createReadingsSettings({ storage }),
  }),
  row({
    path: "voice_input.silence_ms",
    store: "vadSettings",
    field: ["silenceMs"],
    scope: "global",
    access: "direct",
    labelKey: "voice_input.silence_label",
    min: VAD_SILENCE_MIN,
    max: VAD_SILENCE_MAX,
    write: (stores, value) => stores.vadSettings.setSilenceMs(value as number),
    factory: (storage) => createVadSettings({ storage }),
  }),
  row({
    path: "voice_input.barge_in",
    store: "vadSettings",
    field: ["bargeIn"],
    scope: "global",
    access: "direct",
    labelKey: "voice_input.bargein_label",
    write: (stores, value) => stores.vadSettings.setBargeIn(value as boolean),
    factory: (storage) => createVadSettings({ storage }),
  }),
  row({
    path: "character.reasoning_effort",
    store: "agentSettings",
    field: ["reasoning_effort"],
    scope: "char",
    access: "direct",
    labelKey: "reasoning.label",
    values: REASONING_EFFORTS,
    write: (stores, value) => stores.agentSettings.setReasoningEffort(value as ReasoningEffort),
    factory: (storage) => createAgentSettings({ storage }),
  }),
  row({
    path: "character.active_hours",
    store: "activeHoursSettings",
    field: ["spans"],
    scope: "char",
    access: "direct",
    labelKey: "active_hours.label",
    nullable: true,
    type: `{ start: "HH:MM"; end: "HH:MM"; pace: ${union(PACES)} }[] | null`,
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
    access: "direct",
    labelKey: "card.user_name",
    note: "no leading or trailing spaces",
    maxLength: MAX_LEN,
    write: (stores, value) => stores.userNameSettings.setName(value as string),
    factory: (storage) => createUserNameSettings({ storage }),
  }),
  row({
    path: "appearance.theme",
    store: "themeSettings",
    field: ["theme"],
    scope: "global",
    access: "direct",
    labelKey: "appearance.label",
    values: THEMES,
    write: (stores, value) => stores.themeSettings.setTheme(value as Theme),
    factory: (storage) => createThemeSettings({ storage }),
  }),
  row({
    path: "appearance.text_size",
    store: "textSizeSettings",
    field: ["scale"],
    scope: "global",
    access: "direct",
    labelKey: "textsize.label",
    values: TEXT_SIZES,
    write: (stores, value) => stores.textSizeSettings.setScale(value as TextSize),
    factory: (storage) => createTextSizeSettings({ storage }),
  }),
  row({
    path: "bubble.keep",
    store: "bubblePersistSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "bubble_persist.label",
    write: (stores, value) => stores.bubblePersistSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(false, { storage }),
  }),
  row({
    path: "body.gaze",
    store: "gazeSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "gaze.label",
    write: (stores, value) => stores.gazeSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "body.climb",
    store: "climbSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "climb.label",
    write: (stores, value) => stores.climbSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "body.fall",
    store: "fallSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "fall.label",
    write: (stores, value) => stores.fallSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "body.mouth_gain",
    store: "lipsyncSettings",
    field: ["gain"],
    scope: "global",
    access: "direct",
    labelKey: "expression.mouth_label",
    min: LIPSYNC_GAIN_MIN,
    max: LIPSYNC_GAIN_MAX,
    write: (stores, value) => stores.lipsyncSettings.setGain(value as number),
    factory: (storage) => createLipsyncSettings({ storage }),
  }),
  row({
    path: "pace.base",
    store: "basePaceSettings",
    field: ["pace"],
    scope: "global",
    access: "direct",
    labelKey: "base_pace.title",
    values: ["high", "normal", "low"] satisfies readonly BasePace[],
    write: (stores, value) => stores.basePaceSettings.setPace(value as BasePace),
    factory: (storage) => createBasePaceSettings({ storage }),
  }),
  row({
    path: "threads.reactions",
    store: "threadReactionsSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "threadReactions.label",
    write: (stores, value) => stores.threadReactionsSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "threads.reaction_count",
    store: "threadReactionThresholdsSettings",
    field: ["count"],
    scope: "global",
    access: "direct",
    labelKey: "threadReactionThresholds.count_label",
    values: REACTION_COUNTS,
    write: (stores, value) =>
      stores.threadReactionThresholdsSettings.setCount(value as ReactionCount),
    factory: (storage) => createThreadReactionThresholdsSettings({ storage }),
  }),
  row({
    path: "threads.reaction_wait_min",
    store: "threadReactionThresholdsSettings",
    field: ["wait_min"],
    scope: "global",
    access: "direct",
    labelKey: "threadReactionThresholds.wait_label",
    values: REACTION_WAITS,
    write: (stores, value) =>
      stores.threadReactionThresholdsSettings.setWait(value as ReactionWait),
    factory: (storage) => createThreadReactionThresholdsSettings({ storage }),
  }),
  row({
    path: "relations.enabled",
    store: "relationsSwitch",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "relations.section",
    write: (stores, value) => stores.relationsSwitch.setEnabled(value as boolean),
    factory: (storage) => createRelationsSwitch(storage),
  }),
  row({
    path: "unified_chat",
    store: "unifiedChatSwitch",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "unified.enable_label",
    write: (stores, value) => stores.unifiedChatSwitch.setEnabled(value as boolean),
    factory: (storage) => createUnifiedChatSwitch(storage),
  }),
  row({
    path: "performance.idle_throttle",
    store: "idleThrottleSettings",
    field: ["enabled"],
    scope: "global",
    access: "direct",
    labelKey: "perf.idle_label",
    write: (stores, value) => stores.idleThrottleSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(true, { storage }),
  }),
  row({
    path: "pace.rest",
    store: "dndSettings",
    field: ["enabled"],
    scope: "global",
    access: "allow",
    labelKey: "character_menu.rest",
    write: (stores, value) => stores.dndSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(false, { storage }),
  }),
  row({
    path: "privacy.screenshot",
    store: "screenshotSettings",
    field: ["enabled"],
    scope: "global",
    access: "allow",
    labelKey: "screenshot.label",
    write: (stores, value) => stores.screenshotSettings.setEnabled(value as boolean),
    factory: (storage) => createScreenshotSettings({ storage }),
  }),
  row({
    path: "privacy.screen_requests",
    store: "screenshotSettings",
    field: ["allowRequests"],
    scope: "global",
    access: "allow",
    labelKey: "screenshot.request_label",
    write: (stores, value) => stores.screenshotSettings.setAllowRequests(value as boolean),
    factory: (storage) => createScreenshotSettings({ storage }),
  }),
  row({
    path: "privacy.screen_display",
    store: "screenshotSettings",
    field: ["source"],
    scope: "global",
    access: "allow",
    labelKey: "screenshot.source_label",
    toField: (index) => ({ kind: "monitor", index }),
    // A window or browser tab source names no display.
    read: (stores) => {
      const { source } = stores.screenshotSettings.get();
      return source.kind === "monitor" ? source.index : null;
    },
    type: "number | null",
    note: "null means a window or tab source and cannot be written",
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
    access: "allow",
    labelKey: "screen.label",
    write: (stores, value) => stores.screenSettings.setEnabled(value as boolean),
    factory: (storage) => createFlagSettings(false, { storage }),
  }),
  row({
    path: "privacy.screen_watch.prev_dwell_ms",
    store: "screenKnobSettings",
    field: ["prev_dwell_ms"],
    scope: "global",
    access: "allow",
    labelKey: "screen.prev_dwell_label",
    min: 0,
    max: SCREEN_MS_MAX,
    integer: true,
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
    access: "allow",
    labelKey: "screen.settle_label",
    min: 0,
    max: SCREEN_MS_MAX,
    integer: true,
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
    access: "allow",
    labelKey: "screen.long_session_label",
    min: 0,
    max: SCREEN_MS_MAX,
    integer: true,
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
    access: "allow",
    labelKey: "screen.recent_cap_label",
    min: 0,
    max: SCREEN_RECENT_CAP_MAX,
    integer: true,
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
    access: "allow",
    labelKey: "agentNotify.label",
    write: (stores, value) => stores.agentNotifySettings.setEnabled(value as boolean),
    factory: (storage) => createAgentNotifySettings({ storage }),
  }),
  row({
    path: "privacy.thread_turns",
    store: "threadTurnsSettings",
    field: ["level"],
    scope: "global",
    access: "allow",
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
    access: "allow",
    labelKey: "reactions.rate_tier2_label",
    min: 0,
    max: RATE_LIMIT_MAX,
    integer: true,
    write: (stores, value) => stores.guardrailsSettings.set({ tier2_max: value as number }),
    zeroIsDefault: true,
    factory: (storage) => createGuardrailsSettings({ storage }),
  }),
  row({
    path: "limits.urgent_max",
    store: "guardrailsSettings",
    field: ["urgent_max"],
    scope: "global",
    access: "allow",
    labelKey: "reactions.rate_urgent_label",
    min: 0,
    max: RATE_LIMIT_MAX,
    integer: true,
    write: (stores, value) => stores.guardrailsSettings.set({ urgent_max: value as number }),
    zeroIsDefault: true,
    factory: (storage) => createGuardrailsSettings({ storage }),
  }),
  row({
    path: "limits.addressed_chain_max",
    store: "guardrailsSettings",
    field: ["addressed_chain_max"],
    scope: "global",
    access: "allow",
    labelKey: "reactions.rate_addressed_label",
    min: 0,
    max: RATE_LIMIT_MAX,
    integer: true,
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
    access: "allow",
    labelKey: "reactions.pacer_gap_label",
    min: 0,
    max: PACER_GAP_MAX,
    integer: true,
    zeroNote: "0 turns the wait off",
    write: (stores, value) => stores.pacerGapSettings.set(value as number),
    unit: { per: 60_000, suffixKey: "reactions.minutes_suffix" },
    factory: (storage) => createPacerGapStore(storage),
  }),
];
