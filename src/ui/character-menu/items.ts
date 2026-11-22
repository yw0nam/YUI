/** The Character menu's items for a pet window: the top level in two columns, and each list. */

import type { BasePace } from "../../settings/active-hours/base-pace-settings";

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

export function topItems(
  _kind: MenuKind,
  _state: MenuState,
): { right: MenuItem[]; left: MenuItem[] } {
  return { right: [], left: [] };
}

export function listItems(_list: ListId, _kind: MenuKind, _state: MenuState): MenuItem[] {
  return [];
}
