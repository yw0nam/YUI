/** What the Threads window hands a vanilla tab body, and what that body gives back. */

/** What the view hands each tab's body. */
export interface TabShell {
  /** The narrow layout's way back to the list, for the tab's pane head. */
  back: HTMLButtonElement;
  /** A row was picked: true when the list hid. */
  selected(): boolean;
  /** Focuses the selected row in the list or the rail, whichever shows. */
  focusSelected(): void;
  /** The tab's head count or waiting changed. */
  headChanged(): void;
}

/** What the window's head, layout and keys read of a tab. */
export interface TabView {
  /** The head's count while the tab shows ("" hides it), and whether something waits for the user. */
  head(): { count: string; waiting: boolean };
  hasSelection(): boolean;
  focusList(): void;
  focusRail(): void;
  move(delta: 1 | -1): void;
  /** Its tab became the shown one. */
  shown(): void;
}

/** A vanilla tab's body, laid out and keyed by the view's one layout. */
export interface TabBody extends TabView {
  el: HTMLElement;
  /** Its list pane; a pointerdown inside keeps the overlay. */
  list: HTMLElement;
  dispose(): void;
}
