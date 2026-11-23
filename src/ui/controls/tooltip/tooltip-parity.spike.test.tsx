// @vitest-environment jsdom
// Throwaway spike for #2029: can Base UI Tooltip (one popup, detached triggers through a handle)
// replace the settings hint tooltip (src/ui/quick-controls/hint-tooltip.ts)?
// Arm "today"   = createHintTooltip over `data-tip` buttons.
// Arm "plain"   = Tooltip.createHandle + Root + Portal/Positioner/Popup + Trigger render={<button/>}.
//                 Config props only (delay 150, side bottom, sideOffset 6, collisionPadding 8): no wrapper code.
// Arm "wrapped" = plain, plus the lines between WRAP-BEGIN and WRAP-END (the wrapper's cost).
// Each case asserts what every arm actually does; where an arm differs from "today" the case
// says whether the difference is an "accepted default" candidate or "needs wrapper".
// jsdom does not match :focus-visible (Base UI skips the check: floating-ui-react/utils/element.js:89)
// and has no layout, so the keyboard-modality gate is only marked, not measured, here.

import { mergeProps } from "@base-ui/react/merge-props";
import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act, cloneElement, type ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHintTooltip } from "../../quick-controls/hint-tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ArmName = "today" | "plain" | "wrapped";
type Handle = ReturnType<typeof Tooltip.createHandle<string>>;

const TIP_A = "Explains the screen-watch section in full detail";
const TIP_B = "Explains the rate-cap section in full detail";
const TIP_C0 = "Collapse sections rail";
const TIP_C1 = "Expand sections rail";

interface Ctx {
  a: HTMLElement;
  b: HTMLElement;
  c: HTMLElement; // its tip changes: TIP_C0 -> TIP_C1
  setTipC(text: string): void; // today: set data-tip then refresh(); Base: re-render with a new payload
  removeA(): void;
  /** The one popup element that is open (today: .is-open; Base: [data-open]), or null. */
  open(): HTMLElement | null;
  /** How many popup elements exist in the document at all. */
  popupCount(): number;
  hide(): void; // today: tooltip.hide(); Base: handle.close()
  dispose(): void;
}

// ---- arm "today" ---------------------------------------------------------------------------
function mountToday(): Ctx {
  const root = document.createElement("div");
  const mk = (id: string, tip: string) => {
    const el = document.createElement("button");
    el.type = "button";
    el.dataset.k = id;
    el.dataset.tip = tip;
    el.textContent = "?";
    return el;
  };
  const a = mk("a", TIP_A);
  const b = mk("b", TIP_B);
  const c = mk("c", TIP_C0);
  root.append(a, b, c);
  document.body.appendChild(root);
  const tooltip = createHintTooltip({ root });
  return {
    a,
    b,
    c,
    setTipC(text) {
      c.dataset.tip = text;
      tooltip.refresh();
    },
    removeA: () => a.remove(),
    open: () => document.querySelector<HTMLElement>(".yui-hint-tip.is-open"),
    popupCount: () => document.querySelectorAll(".yui-hint-tip").length,
    hide: () => tooltip.hide(),
    dispose() {
      tooltip.dispose();
      root.remove();
    },
  };
}

// ---- arm "plain": Base UI with a handle, no wrapper code ----------------------------------------
function PlainPopup({ handle }: { handle: Handle }) {
  return (
    <Tooltip.Root handle={handle}>
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner side="bottom" sideOffset={6} collisionPadding={8}>
            <Tooltip.Popup className="yui-hint-tip">{payload as string}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

// ---- arm "wrapped": the smallest wrapper that closes the a11y and hover gaps ----------------------
// WRAP-BEGIN
const TIP_ID = "yui-hint-tip";

/** The one popup. Mount it once beside the panel. */
function HintTipHost({ handle }: { handle: Handle }) {
  return (
    <Tooltip.Root handle={handle} disableHoverablePopup>
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner side="bottom" sideOffset={6} collisionPadding={8}>
            <Tooltip.Popup className="yui-hint-tip" id={TIP_ID} role="tooltip">
              {payload as string}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

/** Wraps one control: `<HintTip handle text="..."><button/></HintTip>`. */
function HintTip({
  handle,
  text,
  children,
}: {
  handle: Handle;
  text: string;
  children: ReactElement<object>;
}) {
  return (
    <Tooltip.Trigger
      handle={handle}
      payload={text}
      delay={150}
      closeOnClick={false} // a keyboard activation keeps the tip; only a pointer press closes it
      render={(props, state) =>
        cloneElement(
          children,
          mergeProps(children.props, props, {
            "aria-describedby": state.open ? TIP_ID : undefined,
            onPointerDown: () => handle.close(),
          }),
        )
      }
    />
  );
}
// WRAP-END

let setTipFromOutside: (text: string) => void = () => {};
let setShowA: (show: boolean) => void = () => {};

function ReactArm({ handle, wrapped }: { handle: Handle; wrapped: boolean }) {
  const [tipC, setTipC] = useState(TIP_C0);
  const [showA, setA] = useState(true);
  setTipFromOutside = setTipC;
  setShowA = setA;
  const Popup = wrapped ? HintTipHost : PlainPopup;
  const trig = (id: string, text: string) =>
    wrapped ? (
      <HintTip handle={handle} text={text}>
        <button type="button" data-k={id}>
          ?
        </button>
      </HintTip>
    ) : (
      <Tooltip.Trigger
        handle={handle}
        payload={text}
        delay={150}
        render={<button type="button" data-k={id} />}
      >
        ?
      </Tooltip.Trigger>
    );
  return (
    <>
      {showA && trig("a", TIP_A)}
      {trig("b", TIP_B)}
      {trig("c", tipC)}
      <Popup handle={handle} />
    </>
  );
}

function mountReact(wrapped: boolean): Ctx {
  const handle = Tooltip.createHandle<string>();
  render(<ReactArm handle={handle} wrapped={wrapped} />);
  const byId = (id: string) => document.querySelector<HTMLElement>(`[data-k="${id}"]`)!;
  return {
    a: byId("a"),
    b: byId("b"),
    c: byId("c"),
    setTipC: (text) => act(() => setTipFromOutside(text)),
    removeA: () => act(() => setShowA(false)),
    open: () => document.querySelector<HTMLElement>(".yui-hint-tip[data-open]"),
    popupCount: () => document.querySelectorAll(".yui-hint-tip").length,
    hide: () => act(() => handle.close()),
    dispose: () => act(() => cleanup()),
  };
}

const arms: readonly (readonly [ArmName, () => Ctx])[] = [
  ["today", mountToday],
  ["plain", () => mountReact(false)],
  ["wrapped", () => mountReact(true)],
];

// ---- event helpers shared by every arm ------------------------------------------------------------
/** Pointer enters and moves once over the target (Base UI opens on a resting pointer). */
function hoverIn(el: HTMLElement) {
  fireEvent.pointerEnter(el, { pointerType: "mouse" });
  fireEvent.mouseEnter(el);
  fireEvent.mouseMove(el, { movementX: 4, movementY: 4 });
}
function hoverOut(el: HTMLElement) {
  fireEvent.pointerLeave(el, { pointerType: "mouse" });
  fireEvent.mouseLeave(el);
}
function pressClick(el: HTMLElement, detail = 1) {
  fireEvent.pointerDown(el, { pointerType: "mouse" });
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el, { detail });
}
function keyboardModality(key = "Tab") {
  fireEvent.keyDown(document.body, { key });
}
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
function focus(el: HTMLElement) {
  act(() => el.focus());
}
function blur(el: HTMLElement) {
  act(() => el.blur());
  tick(1);
}

let ctx: Ctx;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  ctx?.dispose();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(arms)("Tooltip parity (%s)", (arm, mount) => {
  // ---- hover ------------------------------------------------------------------------------------
  it("T1 hover opens after 150 ms, not before", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(149);
    expect(ctx.open()).toBeNull();
    tick(1);
    expect(ctx.open()?.textContent).toBe(TIP_A);
  });

  it("T2 leaving before 150 ms cancels the pending open", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(100);
    hoverOut(ctx.a);
    tick(100);
    expect(ctx.open()).toBeNull();
  });

  it("T3 leaving closes an open tooltip at once", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    expect(ctx.open()).not.toBeNull();
    hoverOut(ctx.a);
    tick(1);
    // Same on every arm. jsdom has no layout, so Base UI's hoverable-popup grace area (safePolygon,
    // TooltipTrigger.js:127) cannot be measured here; today's popup is pointer-events:none, Base UI's
    // default popup stays open while the pointer is inside it. accepted default (hoverable, WCAG 1.4.13);
    // `disableHoverablePopup` on Root is the 1-line switch if the pointer-events:none behaviour is wanted.
    expect(ctx.open()).toBeNull();
  });

  it("T4 a click before 150 ms: today still opens, Base UI cancels the pending open", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(50);
    pressClick(ctx.a);
    tick(200);
    // accepted default: a click that cancels the pending open is the better behaviour (TooltipTrigger.js:210-217).
    const want: Record<ArmName, boolean> = { today: true, plain: false, wrapped: false };
    expect(ctx.open() !== null).toBe(want[arm]);
  });

  it("T5 moving from one target to the next waits 150 ms again on every arm", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    expect(ctx.open()?.textContent).toBe(TIP_A);
    hoverOut(ctx.a);
    hoverIn(ctx.b);
    tick(0);
    // Base UI closes A on mouseleave (closeDelay 0), so B is a fresh rest-open. The instant hand-over
    // (useHoverReferenceInteraction.js:174-181) needs A to still be open or fading: a fade is not
    // observable in jsdom.
    expect(ctx.open()).toBeNull();
    tick(150);
    expect(ctx.open()?.textContent).toBe(TIP_B);
  });

  // ---- focus ------------------------------------------------------------------------------------
  it("T6 focus after a focus-moving key opens at once and blur closes", () => {
    ctx = mount();
    keyboardModality();
    focus(ctx.a);
    expect(ctx.open()?.textContent).toBe(TIP_A);
    blur(ctx.a);
    expect(ctx.open()).toBeNull();
  });

  it("T7 focus with no keyboard modality (after a pointerdown): today stays closed; jsdom cannot measure Base UI", () => {
    ctx = mount();
    fireEvent.pointerDown(document.body);
    focus(ctx.a);
    // jsdom: Base UI's matchesFocusVisible returns true when jsdom (element.js:89), so it opens here.
    // In a browser the gate is `:focus-visible` (useFocus.js:108), measured separately, not in this file.
    const want: Record<ArmName, boolean> = { today: false, plain: true, wrapped: true };
    expect(ctx.open() !== null).toBe(want[arm]);
  });

  // ---- click ------------------------------------------------------------------------------------
  it("T8 a pointer click on the target closes its open tooltip", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    expect(ctx.open()).not.toBeNull();
    pressClick(ctx.a);
    tick(1);
    expect(ctx.open()).toBeNull();
  });

  it("T9 a keyboard activation (click, detail 0) keeps the focused tooltip and picks up the new text", () => {
    ctx = mount();
    keyboardModality();
    focus(ctx.c);
    expect(ctx.open()?.textContent).toBe(TIP_C0);
    fireEvent.click(ctx.c, { detail: 0 });
    ctx.setTipC(TIP_C1);
    tick(1);
    // Base UI closes on any click, detail 0 included (TooltipTrigger.js:214, useDismiss.js referencePress).
    // needs wrapper: `closeOnClick={false}` plus `onPointerDown: () => handle.close()` (4 lines in HintTip),
    // or accepted default (the tip of a toggled control closes on Enter / Space and returns on the next focus move).
    const want: Record<ArmName, string | undefined> = {
      today: TIP_C1,
      plain: undefined,
      wrapped: TIP_C1,
    };
    expect(ctx.open()?.textContent).toBe(want[arm]);
  });

  // ---- exclusivity ------------------------------------------------------------------------------
  it("T10 one popup at a time: focusing the next target moves the one popup", () => {
    ctx = mount();
    keyboardModality();
    focus(ctx.a);
    focus(ctx.b);
    tick(1);
    expect(ctx.open()?.textContent).toBe(TIP_B);
    expect(ctx.popupCount()).toBe(1);
  });

  // ---- escape -----------------------------------------------------------------------------------
  it("T11 Escape on the focused target: closes the tooltip; does the panel's document listener still see it", () => {
    const panel = vi.fn();
    document.addEventListener("keydown", panel); // registered first, as panel-shell.ts:46-55 does
    try {
      ctx = mount();
      keyboardModality();
      focus(ctx.a);
      panel.mockClear();
      fireEvent.keyDown(ctx.a, { key: "Escape" });
      tick(1);
      expect(ctx.open()).toBeNull();
      // today: the key reaches the panel, which closes the settings window (the test pins that).
      // Base UI: the React onKeyDown on the trigger stops propagation (useDismiss.js:117-119), so the
      // panel never sees an Escape that closed a tooltip. accepted default, and better: Escape closes the tip only.
      const want: Record<ArmName, number> = { today: 1, plain: 0, wrapped: 0 };
      expect(panel).toHaveBeenCalledTimes(want[arm]);
    } finally {
      document.removeEventListener("keydown", panel);
    }
  });

  it("T12 Escape while the pointer-opened tooltip is open and focus is elsewhere (event on body)", () => {
    const panel = vi.fn();
    document.addEventListener("keydown", panel);
    try {
      ctx = mount();
      hoverIn(ctx.a);
      tick(150);
      expect(ctx.open()).not.toBeNull();
      panel.mockClear();
      fireEvent.keyDown(document.body, { key: "Escape" });
      tick(1);
      expect(ctx.open()).toBeNull();
      // The panel listener was registered first, so it runs before Base UI's document listener
      // (useDismiss.js:475); stopPropagation on a document listener cannot hide the key from it.
      expect(panel).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", panel);
    }
  });

  it("T13 Escape before the 150 ms delay cancels the pending open", () => {
    ctx = mount();
    hoverIn(ctx.a);
    fireEvent.keyDown(ctx.a, { key: "Escape" });
    tick(200);
    // Base UI's dismiss only listens while open (useDismiss.js:98), so a pending hover open survives Escape.
    // accepted default (the pointer is still on the target, so the tip would open anyway on the next move).
    const want: Record<ArmName, boolean> = { today: false, plain: true, wrapped: true };
    expect(ctx.open() !== null).toBe(want[arm]);
  });

  // ---- a11y -------------------------------------------------------------------------------------
  it("T14 aria-describedby on the open target, role=tooltip on the popup, removed on close", () => {
    ctx = mount();
    keyboardModality();
    focus(ctx.a);
    const popup = ctx.open()!;
    // Base UI sets neither (no `aria-describedby` and no role anywhere under tooltip/*; it is a visual-only
    // hint for controls that already carry an accessible name). needs wrapper: HintTip's
    // `aria-describedby` + HintTipHost's `id` and `role` (the lines in the WRAP block, about 6).
    const want: Record<ArmName, { role: string | null; describedby: string | null }> = {
      today: { role: "tooltip", describedby: "yui-hint-tip" },
      plain: { role: null, describedby: null },
      wrapped: { role: "tooltip", describedby: "yui-hint-tip" },
    };
    expect({
      role: popup.getAttribute("role"),
      describedby: ctx.a.getAttribute("aria-describedby"),
    }).toEqual(want[arm]);
    keyboardModality();
    focus(ctx.b);
    tick(1);
    expect(ctx.a.hasAttribute("aria-describedby")).toBe(false);
    blur(ctx.b);
    expect(ctx.b.hasAttribute("aria-describedby")).toBe(false);
  });

  it("T15 the tooltip text is the data-tip / payload, not the accessible name", () => {
    ctx = mount();
    ctx.a.setAttribute("aria-label", "Accessible name");
    keyboardModality();
    focus(ctx.a);
    expect(ctx.open()?.textContent).toBe(TIP_A);
  });

  // ---- lifecycle --------------------------------------------------------------------------------
  it("T16 an open tooltip whose target is removed: today stays until the next pointer or focus event, Base UI closes", async () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    expect(ctx.open()).not.toBeNull();
    ctx.removeA();
    await act(async () => {});
    tick(1);
    // accepted default: closeOnActiveTriggerUnmount closes it after a microtask (TooltipRoot.js:61-63,
    // popupStoreUtils.js:399-400). today only hides on the next mouseout / focusout / refresh().
    const want: Record<ArmName, boolean> = { today: true, plain: false, wrapped: false };
    expect(ctx.open() !== null).toBe(want[arm]);
  });

  it("T17 a pending open does not fire after its target is removed", () => {
    ctx = mount();
    hoverIn(ctx.a);
    ctx.removeA();
    tick(200);
    expect(ctx.open()).toBeNull();
  });

  // ---- viewport ---------------------------------------------------------------------------------
  it("T18 scroll and resize hide an open tooltip", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    window.dispatchEvent(new Event("resize"));
    expect(ctx.open() !== null).toBe(arm !== "today");
    // Base UI repositions on scroll and resize instead of hiding: autoUpdate with ancestorScroll and
    // elementResize (useAnchorPositioning.js:308-312, 330). accepted default (the tip follows its target);
    // hide-on-scroll would be a wrapper: ~6 lines (a window scroll + resize listener calling handle.close()).
  });

  // ---- refresh ----------------------------------------------------------------------------------
  it("T19 a data-tip that changes under an open tooltip updates the text", () => {
    ctx = mount();
    hoverIn(ctx.c);
    tick(150);
    expect(ctx.open()?.textContent).toBe(TIP_C0);
    ctx.setTipC(TIP_C1);
    tick(1);
    // today needs refresh() after the change; Base UI re-renders the payload on the same commit.
    // accepted default: `refreshTooltip` (quick-controls.ts:603,650) has no Base UI counterpart.
    expect(ctx.open()?.textContent).toBe(TIP_C1);
  });

  // ---- fade -------------------------------------------------------------------------------------
  it("T20 closing hands the fade to CSS: popup carries data-open, then is gone", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    const popup = ctx.open()!;
    // Base UI states: [data-open], [data-starting-style], [data-ending-style] (TooltipPopupDataAttributes.js).
    // CSS: `.is-open` becomes `[data-open]` plus a `[data-starting-style], [data-ending-style]` opacity rule;
    // afterFadeOut (notices/fade-out.ts) is not needed: useOpenChangeComplete waits for the transition.
    expect(popup.hasAttribute("data-open")).toBe(arm !== "today");
    hoverOut(ctx.a);
    tick(500);
    expect(ctx.popupCount()).toBe(0);
  });

  it("T21 hide() (the settings window closing) closes an open tooltip", () => {
    ctx = mount();
    hoverIn(ctx.a);
    tick(150);
    ctx.hide();
    tick(1);
    expect(ctx.open()).toBeNull();
  });
});

// ---- placement: gap 6, viewport margin 8, flip ------------------------------------------------------
describe.each(arms)("Tooltip placement (%s)", (arm, mount) => {
  const TIP_W = 100;
  const TIP_H = 20;
  function stubLayout(
    vw: number,
    vh: number,
    rect: { left: number; top: number; width: number; height: number },
  ) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: vw });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: vh });
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: vw,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: vh,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => TIP_W,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => TIP_H,
    });
    const full = {
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    };
    const real = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset?.k === "a") return full as DOMRect;
      if (
        this.classList.contains("yui-hint-tip") ||
        this.hasAttribute("data-side") ||
        this.parentElement?.hasAttribute("data-side") === false
      ) {
        return {
          left: 0,
          top: 0,
          right: TIP_W,
          bottom: TIP_H,
          width: TIP_W,
          height: TIP_H,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return real.call(this);
    });
  }
  /** The popup's top-left as the arm positions it: today inline left/top, Base UI the positioner transform. */
  function placedAt(): [number, number] | null {
    const popup = document.querySelector<HTMLElement>(".yui-hint-tip");
    if (!popup) return null;
    if (arm === "today") return [parseFloat(popup.style.left), parseFloat(popup.style.top)];
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
      popup.parentElement!.style.transform,
    );
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }
  async function openA() {
    hoverIn(ctx.a);
    tick(150);
    await act(async () => {});
    tick(1);
  }

  it("P1 room below: centred under the target with a 6 px gap", async () => {
    ctx = mount();
    stubLayout(800, 600, { left: 100, top: 100, width: 20, height: 20 });
    await openA();
    expect(placedAt()).toEqual([60, 126]);
  });

  it("P2 no room below: flips above with the same 6 px gap", async () => {
    ctx = mount();
    stubLayout(800, 600, { left: 100, top: 560, width: 20, height: 20 });
    await openA();
    expect(placedAt()).toEqual([60, 534]);
  });

  it("P3 near the left edge: x is clamped to the 8 px margin", async () => {
    ctx = mount();
    stubLayout(800, 600, { left: 0, top: 100, width: 10, height: 20 });
    await openA();
    expect(placedAt()?.[0]).toBe(8);
  });

  it("P4 near the right edge: x is clamped to 8 px from the right", async () => {
    ctx = mount();
    stubLayout(800, 600, { left: 780, top: 100, width: 10, height: 20 });
    await openA();
    expect(placedAt()?.[0]).toBe(692);
  });
});
