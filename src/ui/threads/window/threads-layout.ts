/**
 * The Threads window's layout by its panel's width: wide (the list beside the thread, or the rail
 * when collapsed), medium (the rail, the list laid over the thread on the toggle), narrow (one pane
 * at a time, with back). The stylesheet lays each out; this keeps the state they read.
 */

/** Pairs with the `@container threads (min-width: 720px)` rule in threads-view.css. */
const WIDE_MIN_PX = 720;
/** Pairs with the `@container threads (min-width: 520px)` rule in threads-view.css. */
const MEDIUM_MIN_PX = 520;

export type ThreadsLayout = "wide" | "medium" | "narrow";

/** The layout a panel content width of `width` px takes. */
export function layoutOf(width: number): ThreadsLayout {
  return width >= WIDE_MIN_PX ? "wide" : width >= MEDIUM_MIN_PX ? "medium" : "narrow";
}

export interface ThreadsLayoutControl {
  /** The head button and Control+Command+S: collapse in wide, the overlay in medium, nothing in narrow. */
  toggle(): void;
  /** Closes the medium overlay; false when none was open. */
  escape(): boolean;
  /** A Thread was picked: the overlay closes and narrow shows the thread; true when the list hid. */
  selected(): boolean;
  /** An open starts without the overlay, on the thread, or on the list when there is none. */
  reset(hasThread: boolean): void;
  /** Focuses the selected Thread in the list or the rail, whichever shows. */
  focusSelected(): void;
  dispose(): void;
}

export function createThreadsLayout(deps: {
  /** Carries the state as data attributes; its width picks the layout. */
  panel: HTMLElement;
  list: HTMLElement;
  toggle: HTMLButtonElement;
  back: HTMLButtonElement;
  /** The stored list choice. */
  collapsed: boolean;
  onCollapsed(collapsed: boolean): void;
  focusList(): void;
  focusRail(): void;
}): ThreadsLayoutControl {
  let layout: ThreadsLayout = "wide";
  let collapsed = deps.collapsed;
  let overlay = false;
  let screen: "list" | "thread" = "thread";

  function apply(): void {
    const { dataset } = deps.panel;
    dataset.collapsed = String(collapsed);
    dataset.overlay = String(overlay);
    dataset.screen = screen;
    const expanded = layout === "wide" ? !collapsed : layout === "medium" ? overlay : true;
    deps.toggle.setAttribute("aria-expanded", String(expanded));
  }

  const listShown = (): boolean =>
    layout === "narrow" || (layout === "wide" ? !collapsed : overlay);

  function setOverlay(on: boolean): void {
    overlay = on;
    apply();
    if (on) deps.focusList();
  }

  function toggle(): void {
    if (layout === "wide") {
      collapsed = !collapsed;
      deps.onCollapsed(collapsed);
      apply();
    } else if (layout === "medium") {
      setOverlay(!overlay);
    }
  }

  // A width change never writes the stored list choice.
  const observer = new ResizeObserver((entries) => {
    const width = entries[entries.length - 1]?.contentRect.width;
    if (width === undefined) return;
    layout = layoutOf(width);
    if (layout !== "medium") overlay = false;
    apply();
  });
  observer.observe(deps.panel);

  function onBack(): void {
    screen = "list";
    apply();
    deps.focusList();
  }

  function onPointerDown(e: PointerEvent): void {
    const target = e.target as Node;
    if (overlay && !deps.list.contains(target) && !deps.toggle.contains(target)) setOverlay(false);
  }

  deps.toggle.addEventListener("click", toggle);
  deps.back.addEventListener("click", onBack);
  document.addEventListener("pointerdown", onPointerDown, true);
  apply();

  return {
    toggle,
    escape() {
      if (!overlay) return false;
      setOverlay(false);
      deps.toggle.focus();
      return true;
    },
    selected() {
      const hid = overlay || (layout === "narrow" && screen === "list");
      overlay = false;
      screen = "thread";
      apply();
      return hid;
    },
    reset(hasThread) {
      overlay = false;
      screen = hasThread ? "thread" : "list";
      apply();
    },
    focusSelected() {
      if (listShown()) deps.focusList();
      else deps.focusRail();
    },
    dispose() {
      observer.disconnect();
      deps.toggle.removeEventListener("click", toggle);
      deps.back.removeEventListener("click", onBack);
      document.removeEventListener("pointerdown", onPointerDown, true);
    },
  };
}
