/** The Character menu's motion: the entrance from her chest, the exit toward it, and a list swap's crossfade. */

import { createExit } from "./exit";

/** The columns the menu acts on: a column leaving in a list swap is out of reach. */
export const LIVE = ".yui-cmenu__col:not(.is-leaving)";

export function createMenuMotion(root: HTMLElement): {
  /** The drawn columns and her name enter from her chest. */
  enter(): void;
  /** Redraws a list swap on `side`; with `crossfade` the old column fades out inert as the new one comes in. */
  swap(side: "left" | "right", crossfade: { back: boolean } | null, redraw: () => void): void;
  /** Sends the menu toward her chest, then calls `done`; `takeBack` stops it first. */
  leave(done: () => void): void;
  takeBack(): void;
  /** Ends every exit at once, for a menu that closes now. */
  stop(): void;
} {
  const menuExit = createExit();
  const swapExit = createExit();

  /** Starts `els` from `state` and lets them transition to how they are drawn. */
  function from(els: readonly Element[], state: string): void {
    for (const el of els) el.classList.add(state);
    void root.offsetWidth;
    for (const el of els) el.classList.remove(state);
  }

  return {
    enter() {
      from([...root.querySelectorAll(".yui-cmenu__col, .yui-cmenu__name")], "is-out");
    },
    swap(side, crossfade, redraw) {
      swapExit.cancel();
      for (const el of root.querySelectorAll(".is-leaving")) el.remove();
      const old = crossfade ? root.querySelector<HTMLElement>(`.yui-cmenu__col--${side}`) : null;
      if (old) {
        root.classList.toggle("is-back", crossfade?.back === true);
        old.classList.add("is-leaving");
        old.setAttribute("inert", "");
      }
      redraw();
      if (!old) return;
      from([...root.querySelectorAll(`${LIVE}.yui-cmenu__col--${side}`)], "is-entering");
      swapExit.run([old], () => old.remove());
    },
    leave(done) {
      root.classList.add("is-closing");
      const columns = [...root.querySelectorAll(LIVE)];
      for (const el of [...columns, ...root.querySelectorAll(".yui-cmenu__name")])
        el.classList.add("is-out");
      menuExit.run(columns, done);
    },
    takeBack() {
      menuExit.cancel();
      root.classList.remove("is-closing");
      for (const el of root.querySelectorAll(".is-out")) el.classList.remove("is-out");
    },
    stop() {
      menuExit.cancel();
      swapExit.cancel();
      root.classList.remove("is-closing", "is-back");
    },
  };
}
