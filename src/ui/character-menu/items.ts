/** The Character menu's items for a pet window: the top level in two columns, and each list. */

import type { MenuKind, MenuState } from "../../io/bridge/settings-bridge";
import type { BasePace } from "../../settings/active-hours/base-pace-settings";
import type { RestChoice, RestState } from "../../settings/rest/rest-choices";
import { clockOf, MIN_MS, minutesLeft, restChoicesAt } from "../../settings/rest/rest-end";
import { t } from "../i18n";

export type ListId = "body" | "voice" | "pace" | "more" | "rest";

export interface MenuItem {
  id: string;
  label: string;
  /** The accessible name where it differs from the label. */
  aria?: string;
  glyph: string;
  /** A divider and a status row are not buttons, and the keyboard passes them by. */
  role: "action" | "toggle" | "choice" | "list" | "back" | "danger" | "divider" | "status";
  /** A toggle's state, a choice that is the current one, or Rest running. */
  on?: boolean;
  /** Rest with no end, whose label cannot say it is on, shows the On text. */
  onText?: boolean;
  /** A choice's value in its store. */
  value?: string;
  badge?: number;
}

const PACES: readonly [BasePace, string][] = [
  ["low", "active_hours.pace_low"],
  ["normal", "active_hours.pace_normal"],
  ["high", "active_hours.pace_high"],
];

const toggle = (id: string, key: string, on: boolean): MenuItem => ({
  id,
  label: t(key),
  glyph: id,
  role: "toggle",
  on,
});

const list = (id: ListId): MenuItem => ({
  id,
  label: t(`character_menu.${id}`),
  glyph: id,
  role: "list",
});

const choice = (
  list: ListId,
  value: string,
  label: string,
  current: string,
  glyph: string = list,
): MenuItem => ({
  id: `${list}:${value}`,
  label,
  glyph,
  role: "choice",
  on: value === current,
  value,
});

/** The most options a Body or Voice list shows; the rest wait behind its "More…". */
const LIST_CAP = 5;

/** The first options in list order, the current one in the last slot when it falls past them. */
export function capped<T extends { id: string }>(
  options: readonly T[],
  current: string,
): readonly T[] {
  const shown = options.slice(0, LIST_CAP);
  const chosen = options.find((o) => o.id === current);
  return !chosen || shown.includes(chosen) ? shown : [...shown.slice(0, -1), chosen];
}

const BACK = (): MenuItem => ({
  id: "back",
  label: t("character_menu.back"),
  aria: t("character_menu.back_aria"),
  glyph: "back",
  role: "back",
});

const moreItems = (list: "body" | "voice"): MenuItem => ({
  id: `${list}-more`,
  label: t("character_menu.more_items"),
  aria: t(`character_menu.${list}_more_aria`),
  glyph: "out",
  role: "action",
});

/** The Rest pill's label: off, the end of a Rest, a Focus's minutes left, or a quiet span's end. */
function restLabel(rest: RestState | null, now: number): string {
  if (!rest) return t("character_menu.rest");
  if (rest.kind === "focus" && rest.endsAt !== undefined)
    return t("character_menu.focus_left", { n: minutesLeft(rest.endsAt, now) });
  const time = rest.endsAt === undefined ? undefined : clockOf(rest.endsAt);
  if (rest.kind === "quiet")
    return time ? t("character_menu.quiet_at", { time }) : t("character_menu.quiet");
  return time ? t("character_menu.rest_at", { time }) : t("character_menu.rest");
}

/** The Rest pill opens its list; a quiet span keeps the off look. */
function restItem(rest: RestState | null, now: number): MenuItem {
  const on = rest?.kind === "rest" || rest?.kind === "focus";
  const label = restLabel(rest, now);
  return { id: "rest", label, glyph: "rest", role: "list", on, onText: on && !rest?.endsAt };
}

/** The running Rest or Focus as its status row reads it. */
function restStatus(rest: RestState, now: number): string {
  if (rest.endsAt === undefined) return t("status.resting");
  if (rest.kind === "focus") return t("status.focus_left", { n: minutesLeft(rest.endsAt, now) });
  return t("character_menu.resting_until", { time: clockOf(rest.endsAt) });
}

const restChoice = (choice: RestChoice): MenuItem => ({
  id: `rest:${choice}`,
  label: t(`character_menu.rest_${choice}`),
  glyph: choice.startsWith("focus") ? "focus" : "rest",
  role: "action",
});

/** Back, the status and End now while a Rest or Focus runs, then the choices but the running one, Focus after a divider. */
function restItems(rest: RestState | null, now: number): MenuItem[] {
  const running = rest?.kind === "quiet" ? null : rest;
  const offered = restChoicesAt(now).filter((c) => c !== running?.choice);
  return [
    BACK(),
    ...(running
      ? [
          {
            id: "rest-status",
            label: restStatus(running, now),
            glyph: "",
            role: "status",
          } as const,
          {
            id: "rest:end",
            label: t("character_menu.rest_end"),
            glyph: "end",
            role: "action",
          } as const,
        ]
      : []),
    ...offered.filter((c) => !c.startsWith("focus")).map(restChoice),
    { id: "rest-divider", label: "", glyph: "", role: "divider" },
    ...offered.filter((c) => c.startsWith("focus")).map(restChoice),
  ];
}

/**
 * Every Rest state the open measures, at an evening instant where every choice is offered:
 * ends at 08:00 and 00:00, whose digits are the widest, and a Focus at its longest.
 */
export function restSamples(): { now: number; states: (RestState | null)[] } {
  const evening = new Date();
  evening.setHours(20, 0, 0, 0);
  const now = evening.getTime();
  const at = (day: number, hour: number) =>
    new Date(evening.getFullYear(), evening.getMonth(), evening.getDate() + day, hour).getTime();
  return {
    now,
    states: [
      null,
      { kind: "rest", choice: "morning", startedAt: now, endsAt: at(1, 8) },
      { kind: "rest", choice: "tonight", startedAt: now, endsAt: at(1, 0) },
      { kind: "rest", choice: "until_off", startedAt: now },
      { kind: "focus", choice: "focus_50", startedAt: now, endsAt: now + 50 * MIN_MS },
      { kind: "quiet", endsAt: at(1, 8) },
    ],
  };
}

export function topItems(
  kind: MenuKind,
  state: MenuState,
  now = Date.now(),
): { right: MenuItem[]; left: MenuItem[] } {
  const right = [
    toggle("talk", "character_menu.talk", state.talk),
    restItem(state.rest, now),
    // Voice input runs in the main window only.
    ...(kind === "main" ? [toggle("listen", "character_menu.listen", state.listen)] : []),
    {
      id: "settings",
      label: t("character_menu.settings"),
      aria: t("character_menu.settings_aria"),
      glyph: "settings",
      role: "action",
    } as const,
  ];
  return { right, left: [list("body"), list("voice"), list("pace"), list("more")] };
}

export function listItems(
  id: ListId,
  kind: MenuKind,
  state: MenuState,
  now = Date.now(),
): MenuItem[] {
  if (id === "rest") return restItems(state.rest, now);
  if (id === "body")
    return [
      BACK(),
      ...capped(state.bodies, state.body).map((o) => choice("body", o.id, o.label, state.body)),
      moreItems("body"),
    ];
  if (id === "voice")
    return [
      BACK(),
      // The empty id is no voice.
      ...capped(state.voices, state.voice).map((o) =>
        o.id === ""
          ? choice("voice", "", t("character_menu.voice_none"), state.voice, "mute")
          : choice("voice", o.id, o.label, state.voice),
      ),
      moreItems("voice"),
    ];
  if (id === "pace")
    return [
      BACK(),
      ...PACES.map(([pace, key]) => choice("pace", pace, t(key), state.pace, `pace-${pace}`)),
    ];
  // The waiting count belongs to main, which owns the Threads.
  const badge = kind === "main" && state.waiting > 0 ? state.waiting : undefined;
  return [
    BACK(),
    {
      id: "threads",
      label: t("threads.title"),
      glyph: "threads",
      role: "action",
      ...(badge === undefined
        ? {}
        : { badge, aria: t("character_menu.threads_waiting", { n: badge }) }),
    },
    toggle("bubble", "character_menu.bubble", state.bubble),
    toggle("unified", "character_menu.unified", state.unified),
    { id: "terminal", label: t("terminal.title"), glyph: "terminal", role: "action" },
    { id: "reset", label: t("character_menu.reset"), glyph: "reset", role: "danger" },
    ...(kind === "bound"
      ? [
          {
            id: "turn-off",
            label: t("character_menu.turn_off"),
            glyph: "off",
            role: "danger",
          } as const,
        ]
      : []),
  ];
}
