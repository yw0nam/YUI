/** The Character menu: two pill columns beside her in the pet window, their lists swapped in place. */

import type { BasePace } from "../../settings/active-hours/base-pace-settings";
import type { MenuKind, MenuState } from "./items";
import type { Fold, MenuWidths } from "./layout";

/** Where the menu draws, in the mount's px. */
export interface MenuPlacement {
  fold: Fold;
  /** The columns' top: her shoulder line. */
  top: number;
  /** Where the pills pop out from. */
  chest: { x: number; y: number };
  /** Her head's top: her name sits above it. */
  head: number;
}

export interface MenuActions {
  talk(open: boolean): void;
  rest(on: boolean): void;
  listen(on: boolean): void;
  settings(page?: "body" | "voice"): void;
  body(id: string): void;
  voice(id: string): void;
  pace(pace: BasePace): void;
  threads(tab: "threads" | "terminal"): void;
  bubble(on: boolean): void;
  unified(on: boolean): void;
  reset(): void;
  turnOff(): void;
}

export function createCharacterMenu(_deps: {
  mount: HTMLElement;
  kind: MenuKind;
  name(): string;
  read(): MenuState;
  /** Widens the window for the measured columns and says where the menu draws. */
  place(widths: MenuWidths): Promise<MenuPlacement>;
  /** Puts the window back once the menu has left the screen. */
  restore(): Promise<void>;
  actions: MenuActions;
  onBlur(cb: () => void): () => void;
}): { open(): Promise<void>; close(): Promise<void>; dispose(): void; isOpen(): boolean } {
  return {
    open: async () => {},
    close: async () => {},
    dispose: () => {},
    isOpen: () => false,
  };
}
