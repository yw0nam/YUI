// @vitest-environment jsdom
// Throwaway spike for #2070: can Base UI replace the shared Segment (segment.tsx) and add `disabled`?
// Arm "A-plain"   = RadioGroup + Radio.Root rendered as <button class="yui-seg__btn">, no wrapper code.
// Arm "A-wrapped" = the same, plus the lines between WRAP-BEGIN and WRAP-END (the wrapper's cost).
// Arm "B"         = ToggleGroup + Toggle, only the cases where it could beat arm A.
// "today" = the existing Segment, run through the same cases as a baseline.
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segment } from "./segment";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Opt<T> {
  value: T;
  label: string;
}
interface Props<T = unknown> {
  options: readonly Opt<T>[];
  value: T;
  onValueChange(value: T): void;
  label: string;
  selectOn?: "focus" | "activate";
  className?: string;
  disabled?: boolean;
}

const LETTERS: Opt<string>[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];
const SCALES: Opt<number>[] = [
  { value: 0, label: "Zero" },
  { value: 1, label: "One" },
  { value: 1.1, label: "Big" },
];

/** Baseline: the shipped component, with `disabled` ignored (it has no such prop). */
function Today(p: Props) {
  return <Segment {...(p as Props<string>)} />;
}

/** A-plain: no wrapper code at all. */
function APlain(p: Props) {
  return (
    <RadioGroup
      className={p.className ? `yui-seg ${p.className}` : "yui-seg"}
      aria-label={p.label}
      value={p.value}
      onValueChange={p.onValueChange}
      disabled={p.disabled}
    >
      {p.options.map((o) => (
        <Radio.Root
          key={String(o.value)}
          value={o.value}
          nativeButton
          render={<button type="button" className="yui-seg__btn" />}
        >
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

const FORWARD = new Set(["ArrowRight", "ArrowDown"]);
const BACKWARD = new Set(["ArrowLeft", "ArrowUp"]);

/** A-wrapped: everything between WRAP-BEGIN and WRAP-END is the wrapper's cost. */
function AWrapped(p: Props) {
  // WRAP-BEGIN
  const activate = p.selectOn === "activate";
  const checkedAt = p.options.findIndex((o) => Object.is(o.value, p.value));
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const [seen, setSeen] = useState(p.value);
  if (!Object.is(seen, p.value)) {
    setSeen(p.value); // a new value settles the tab stop on the checked button (Base UI only does it at mount)
    setFocusAt(null);
  }
  const tabStop = focusAt ?? Math.max(checkedAt, 0);
  // WRAP-END
  return (
    <RadioGroup
      className={p.className ? `yui-seg ${p.className}` : "yui-seg"}
      aria-label={p.label}
      value={p.value}
      onValueChange={p.onValueChange}
      disabled={p.disabled}
      // WRAP-BEGIN
      onKeyDownCapture={(e) => {
        // Base UI marks the group "touched" on any arrow, and a touched group selects on focus.
        if ((activate || checkedAt < 0) && e.key.startsWith("Arrow")) e.preventBaseUIHandler();
      }}
      onKeyDown={(e) => {
        const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
        const at = radios.indexOf(e.target as HTMLElement);
        const step = FORWARD.has(e.key) ? 1 : BACKWARD.has(e.key) ? -1 : 0;
        if (step && !activate && checkedAt < 0) {
          e.preventBaseUIHandler(); // nothing checked: arrows land on the first option
          radios[0]?.click();
          radios[0]?.focus();
        } else if (step && !radios[at + step]) {
          e.preventBaseUIHandler(); // no wrap at the ends
          e.preventDefault();
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          const target = e.key === "Home" ? radios[0] : radios[radios.length - 1];
          if (!activate) target?.click();
          target?.focus();
        }
      }}
      // WRAP-END
    >
      {p.options.map((o, i) => (
        <Radio.Root
          key={String(o.value)}
          value={o.value}
          nativeButton
          render={<button type="button" className="yui-seg__btn" />}
          // WRAP-BEGIN
          data-value={String(o.value)}
          tabIndex={i === tabStop ? 0 : -1}
          onFocus={() => setFocusAt(i)}
          onClick={(e) => e.currentTarget.focus()} // WebKit does not focus a clicked button
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.currentTarget.click();
            }
          }}
          // WRAP-END
        >
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

/** B: ToggleGroup + Toggle. Toggle values are strings only; a group value is an array. */
function BToggle(p: Props) {
  return (
    <ToggleGroup
      className={p.className ? `yui-seg ${p.className}` : "yui-seg"}
      aria-label={p.label}
      value={[String(p.value)]}
      onValueChange={(v) => {
        const hit = p.options.find((o) => String(o.value) === v[0]);
        if (hit) p.onValueChange(hit.value);
      }}
      disabled={p.disabled}
    >
      {p.options.map((o) => (
        <Toggle key={String(o.value)} value={String(o.value)} className="yui-seg__btn">
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

let setHost: (v: unknown) => void = () => {};
/** Holds the value like a store-backed caller does: the group's value follows onValueChange. */
function Host({ Comp, ...p }: { Comp: (p: Props) => React.ReactNode } & Props) {
  const [value, setValue] = useState(p.value);
  setHost = setValue;
  return (
    <>
      {Comp({
        ...p,
        value,
        onValueChange: (v) => {
          p.onValueChange(v);
          setValue(v);
        },
      })}
    </>
  );
}

/** Dispatches a keydown through React, then flushes Base UI's queued microtask focus move. */
async function press(el: Element, key: string) {
  await act(async () => {
    fireEvent.keyDown(el, { key });
  });
}
const radios = () => [...document.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")];
const checkedOf = () => radios().map((r) => r.getAttribute("aria-checked"));
const tabStops = () => radios().map((r) => r.tabIndex);

const arms = [
  ["today", Today],
  ["A-plain", APlain],
  ["A-wrapped", AWrapped],
] as const;

afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
});

describe.each(arms)("Segment parity (%s)", (arm, Comp) => {
  function mount(p: Partial<Props> = {}) {
    const onValueChange = vi.fn();
    const props: Props = {
      options: LETTERS,
      value: "a",
      label: "Letter",
      onValueChange,
      ...p,
    };
    const r = render(<Host Comp={Comp as (p: Props) => React.ReactNode} {...props} />);
    return { ...r, onValueChange };
  }

  // ---- segment.test.tsx cases ----------------------------------------------------------
  it("P1 renders a named radiogroup, named radios, the checked one carries aria-checked and the tab stop", () => {
    const { getByRole, getAllByRole } = mount();
    expect(getByRole("radiogroup", { name: "Letter" })).toBeTruthy();
    expect(getAllByRole("radio").map((r) => r.textContent)).toEqual(["A", "B", "C"]);
    expect(getByRole("radio", { name: "B" })).toBeTruthy();
    expect(checkedOf()).toEqual(["true", "false", "false"]);
    expect(tabStops()).toEqual([0, -1, -1]);
  });

  it("P2 focus mode: ArrowRight selects the next option and focuses it", async () => {
    const { onValueChange } = mount();
    radios()[0].focus();
    await press(radios()[0], "ArrowRight");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(radios()[1]);
  });

  it("P3 after the value changes, aria-checked and the tab stop follow it", async () => {
    mount();
    radios()[0].focus();
    await press(radios()[0], "ArrowRight");
    expect(checkedOf()).toEqual(["false", "true", "false"]);
    expect(tabStops()).toEqual([-1, 0, -1]);
  });

  it("P4 focus mode: a click selects", () => {
    const { onValueChange } = mount();
    fireEvent.click(radios()[2]);
    expect(onValueChange).toHaveBeenLastCalledWith("c");
  });

  it("P5 nothing checked: the first arrow lands on the first option; the tab stop starts on it", async () => {
    const { onValueChange } = mount({ value: "z" });
    expect(checkedOf()).toEqual(["false", "false", "false"]);
    expect(tabStops()).toEqual([0, -1, -1]);
    radios()[0].focus();
    await press(radios()[0], "ArrowRight");
    expect(onValueChange).toHaveBeenLastCalledWith("a");
  });

  it("P6 activate mode: arrows move focus and the tab stop without selecting", async () => {
    const { onValueChange } = mount({ selectOn: "activate" });
    radios()[0].focus();
    await press(radios()[0], "ArrowRight");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(radios()[1]);
    expect(tabStops()).toEqual([-1, 0, -1]);
    expect(checkedOf()).toEqual(["true", "false", "false"]);
  });

  it("P7 activate mode: Enter selects the focused option", async () => {
    const { onValueChange } = mount({ selectOn: "activate" });
    radios()[0].focus();
    await press(radios()[0], "ArrowRight");
    await press(radios()[1], "Enter");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("b");
  });

  // ---- extra cases the issue and the callers ask for ------------------------------------
  it("P8 activate mode: Space (keydown, as general-page.test.tsx fires it) selects exactly once", async () => {
    const { onValueChange } = mount({ selectOn: "activate" });
    radios()[0].focus();
    await press(radios()[0], "ArrowRight");
    await press(radios()[1], " ");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("b");
  });

  it("P9 activate mode: a click selects", () => {
    const { onValueChange } = mount({ selectOn: "activate" });
    fireEvent.click(radios()[2]);
    expect(onValueChange).toHaveBeenLastCalledWith("c");
  });

  it("P10 focus mode: Home and End select the first and last option", async () => {
    const { onValueChange } = mount({ value: "b" });
    radios()[1].focus();
    await press(radios()[1], "End");
    expect(onValueChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(radios()[2]);
    await press(radios()[2], "Home");
    expect(onValueChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(radios()[0]);
  });

  it("P11 activate mode: Home and End move focus only", async () => {
    const { onValueChange } = mount({ value: "b", selectOn: "activate" });
    radios()[1].focus();
    await press(radios()[1], "End");
    expect(document.activeElement).toBe(radios()[2]);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("P12 disabled group: a click selects nothing and every button is natively disabled", () => {
    const { onValueChange, getByRole } = mount({ disabled: true });
    fireEvent.click(radios()[2]);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(radios().map((r) => r.disabled)).toEqual([true, true, true]);
    expect(getByRole("radiogroup").getAttribute("aria-disabled")).toBe("true");
  });

  it("P13 disabled group: keys select nothing and no button takes focus", async () => {
    const { onValueChange } = mount({ disabled: true });
    expect(radios().every((r) => r.disabled)).toBe(true); // jsdom focuses a disabled button; a browser does not
    await press(radios()[0], "ArrowRight");
    await press(radios()[0], "End");
    await press(radios()[0], "Enter");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("P14 the checked button carries [aria-checked=true] for segment.css", () => {
    mount({ value: "b" });
    expect(document.querySelectorAll('.yui-seg__btn[aria-checked="true"]')).toHaveLength(1);
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
  });

  it("P15 className sits beside yui-seg on the group", () => {
    const { getByRole } = mount({ className: "yui-lang-seg" });
    expect(getByRole("radiogroup").className.split(" ").sort()).toEqual(["yui-lang-seg", "yui-seg"]);
  });

  it("P16 values that are not strings (0, 1, 1.1): click selects the number itself, checked follows", () => {
    const { onValueChange } = mount({ options: SCALES as Opt<unknown>[], value: 1 });
    expect(checkedOf()).toEqual(["false", "true", "false"]);
    fireEvent.click(radios()[2]);
    expect(onValueChange).toHaveBeenLastCalledWith(1.1);
    fireEvent.click(radios()[0]);
    expect(onValueChange).toHaveBeenLastCalledWith(0);
    expect(checkedOf()).toEqual(["true", "false", "false"]);
  });

  it("P17 each button keeps data-value (general-page.test.tsx and others query it)", () => {
    mount({ options: SCALES as Opt<unknown>[], value: 1 });
    expect(radios().map((r) => r.dataset.value)).toEqual(["0", "1", "1.1"]);
  });

  it("P18 focus mode: arrows stop at the ends (today clamps, no wrap)", async () => {
    const { onValueChange } = mount({ value: "c" });
    radios()[2].focus();
    await press(radios()[2], "ArrowRight");
    expect(document.activeElement).toBe(radios()[2]);
    expect(onValueChange).not.toHaveBeenCalledWith("a");
  });

  it("P19 focus mode: Enter on a focused, unchecked option selects it", async () => {
    const { onValueChange } = mount();
    radios()[1].focus();
    // A browser clicks a button on an Enter keydown that nobody prevented; jsdom does not.
    const notPrevented = fireEvent.keyDown(radios()[1], { key: "Enter" });
    expect(notPrevented || onValueChange.mock.calls.at(-1)?.[0] === "b").toBe(true);
  });

  it("P20 a click moves focus and the tab stop to the clicked option (WebKit does not focus a clicked button)", () => {
    mount();
    fireEvent.click(radios()[2]); // jsdom, like WebKit, does not focus on click
    expect(document.activeElement).toBe(radios()[2]);
    expect(tabStops()).toEqual([-1, -1, 0]);
  });

  it("P21 a value set from outside moves the tab stop to the checked option", () => {
    mount();
    act(() => setHost("c"));
    expect(checkedOf()).toEqual(["false", "false", "true"]);
    expect(tabStops()).toEqual([-1, -1, 0]);
  });

  it("P22 clicking the already-checked option still reports it (today calls onValueChange)", () => {
    const { onValueChange } = mount();
    fireEvent.click(radios()[0]);
    expect(onValueChange).toHaveBeenCalledWith("a");
  });

  it("P23 DOM shape: group is a div, buttons are <button type=button>, and no hidden inputs", () => {
    const { container } = mount();
    expect(container.querySelector(".yui-seg")?.tagName).toBe("DIV");
    expect(radios().map((r) => `${r.tagName}:${r.getAttribute("type")}`)).toEqual([
      "BUTTON:button",
      "BUTTON:button",
      "BUTTON:button",
    ]);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });
});

// ---- Arm B: only what could beat arm A -------------------------------------------------
describe("Segment parity (B ToggleGroup + Toggle)", () => {
  function mountB(p: Partial<Props> = {}) {
    const onValueChange = vi.fn();
    const r = render(
      <Host
        Comp={BToggle as (p: Props) => React.ReactNode}
        options={LETTERS}
        value="a"
        label="Letter"
        onValueChange={onValueChange}
        {...p}
      />,
    );
    return { ...r, onValueChange };
  }

  it("B1 the group is role=group, not radiogroup; the buttons are role=button with aria-pressed", () => {
    const { queryByRole, queryAllByRole, getAllByRole } = mountB();
    expect(queryByRole("radiogroup")).toBeNull();
    expect(queryByRole("group", { name: "Letter" })).toBeTruthy();
    expect(queryAllByRole("radio")).toHaveLength(0);
    expect(getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("B2 Home and End move focus natively (enableHomeAndEndKeys), without selecting", async () => {
    const { onValueChange } = mountB();
    radios()[0].focus();
    await press(radios()[0], "End");
    expect(document.activeElement).toBe(radios()[2]);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("B3 clicking the pressed button un-presses it: onValueChange never reports the same option twice and the group can empty", () => {
    const { onValueChange } = mountB();
    fireEvent.click(radios()[0]);
    expect(onValueChange).not.toHaveBeenCalled(); // the wrapper drops the empty array; value stays "a"
    expect(radios()[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("B4 an option whose value is 0 keeps its identity", () => {
    const { onValueChange } = mountB({ options: SCALES as Opt<unknown>[], value: 1 });
    fireEvent.click(radios()[0]);
    expect(onValueChange).toHaveBeenLastCalledWith(0);
  });
});
