/** The Character menu's items for a pet window: the top level in two columns, and each list. */

import type { BasePace } from "../../settings/active-hours/base-pace-settings";
import { t } from "../i18n";

export type MenuKind = "main" | "bound";
export type ListId = "body" | "voice" | "pace" | "more";

export interface MenuItem {
  id: string;
  label: string;
  /** The accessible name where it differs from the label. */
  aria?: string;
  glyph: string;
  role: "action" | "toggle" | "choice" | "list" | "back" | "danger";
  /** A toggle's state, or a choice that is the current one. */
  on?: boolean;
  /** A choice's value in its store. */
  value?: string;
  badge?: number;
}

export interface MenuState {
  talk: boolean;
  rest: boolean;
  listen: boolean;
  bubble: boolean;
  unified: boolean;
  bodies: readonly { id: string; label: string }[];
  body: string;
  voices: readonly { id: string; label: string }[];
  voice: string;
  pace: BasePace;
  /** Threads waiting for the user's answer. */
  waiting: number;
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

const choice = (list: ListId, value: string, label: string, current: string): MenuItem => ({
  id: `${list}:${value}`,
  label,
  glyph: list,
  role: "choice",
  on: value === current,
  value,
});

const BACK = (): MenuItem => ({
  id: "back",
  label: t("character_menu.back"),
  glyph: "back",
  role: "back",
});

const moreItems = (list: "body" | "voice"): MenuItem => ({
  id: `${list}-more`,
  label: t("character_menu.more_items"),
  glyph: "out",
  role: "action",
});

export function topItems(
  kind: MenuKind,
  state: MenuState,
): { right: MenuItem[]; left: MenuItem[] } {
  const right = [
    toggle("talk", "character_menu.talk", state.talk),
    { ...toggle("rest", "character_menu.rest", state.rest), aria: t("character_menu.rest_aria") },
    // Voice input runs in the main window only.
    ...(kind === "main" ? [toggle("listen", "character_menu.listen", state.listen)] : []),
    {
      id: "settings",
      label: t("character_menu.settings"),
      glyph: "settings",
      role: "action",
    } as const,
  ];
  return { right, left: [list("body"), list("voice"), list("pace"), list("more")] };
}

export function listItems(id: ListId, kind: MenuKind, state: MenuState): MenuItem[] {
  if (id === "body")
    return [
      BACK(),
      ...state.bodies.map((o) => choice("body", o.id, o.label, state.body)),
      moreItems("body"),
    ];
  if (id === "voice")
    return [
      BACK(),
      ...state.voices.map((o) =>
        choice("voice", o.id, o.id === "" ? t("character_menu.voice_none") : o.label, state.voice),
      ),
      moreItems("voice"),
    ];
  if (id === "pace")
    return [BACK(), ...PACES.map(([pace, key]) => choice("pace", pace, t(key), state.pace))];
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
