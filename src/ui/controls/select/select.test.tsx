// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelShell } from "../../quick-controls/panel-shell";
import { keyboardFocus, shownTip } from "../tooltip/tip-test-helpers";
import { TooltipHost } from "../tooltip/tooltip";
import { Select, type SelectProps } from "./select";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Fruit = "apple" | "banana";
const FRUITS = [
  { value: "apple", label: "Apple, the long name" },
  { value: "banana", label: "Banana, the long name" },
] as const;

/** Holds the value like a store-backed caller does. */
function Host({
  items = FRUITS,
  ...props
}: Omit<SelectProps<Fruit>, "value" | "items" | "aria-label"> & {
  items?: SelectProps<Fruit>["items"];
}) {
  const [value, setValue] = useState<Fruit>("apple");
  return (
    <Select
      {...props}
      value={value}
      items={items}
      aria-label="Fruit"
      onValueChange={(next) => {
        props.onValueChange(next);
        setValue(next);
      }}
    />
  );
}

/** Base UI opens on a click and takes an item's click only after a pointer press on it. */
async function open(trigger: HTMLElement) {
  await act(async () => {
    fireEvent.click(trigger);
  });
}

/** The items of the open popup; a closed popup stays mounted under a hidden positioner. */
const shownOptions = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(
    (o) => !o.closest("[hidden]"),
  );

async function pick(name: string) {
  const option = shownOptions().find((o) => o.textContent === name)!;
  await act(async () => {
    fireEvent.pointerDown(option);
    fireEvent.click(option);
  });
}

/** The trigger, asserted before a case presses it. */
function trigger(): HTMLElement {
  const found = screen.queryByRole("combobox", { name: "Fruit" });
  expect(found).not.toBeNull();
  return found!;
}

async function pressEscape(target: Element) {
  await act(async () => {
    fireEvent.keyDown(target, { key: "Escape" });
  });
}

describe("Select", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("a pick reports the value once and the trigger shows its label; picking it again reports nothing", async () => {
    const onValueChange = vi.fn();
    render(<Host onValueChange={onValueChange} />);
    const select = trigger();
    expect(select.textContent).toBe("Apple, the long name");

    await open(select);
    await pick("Banana, the long name");

    expect(onValueChange.mock.calls).toEqual([["banana"]]);
    expect(select.textContent).toBe("Banana, the long name");

    await open(select);
    await pick("Banana, the long name");

    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("the closed trigger shows the value label while the popup lists the item labels", async () => {
    render(
      <Host onValueChange={() => {}} valueLabel={(v) => (v === "apple" ? "Apple" : "Banana")} />,
    );
    const select = trigger();
    expect(select.textContent).toBe("Apple");

    await open(select);

    expect(shownOptions().map((o) => o.textContent)).toEqual([
      "Apple, the long name",
      "Banana, the long name",
    ]);
    await pick("Banana, the long name");
    expect(select.textContent).toBe("Banana");
  });

  it("a disabled select does not open", async () => {
    render(<Host onValueChange={() => {}} disabled />);

    await open(trigger());

    expect(shownOptions()).toHaveLength(0);
  });

  it("the first Escape in the open popup closes it and returns focus without closing the window; the next closes the window", async () => {
    const closeWindow = vi.fn();
    const onClose = vi.fn();
    const root = document.body.appendChild(document.createElement("div"));
    const shell = createPanelShell({ root, closeWindow, onOpen: () => {}, onClose });
    shell.open();
    render(<Host onValueChange={() => {}} />, { container: root });
    const select = trigger();

    await open(select);
    const inside = document.activeElement!;
    expect(screen.getByRole("listbox").contains(inside)).toBe(true);

    await pressEscape(inside);

    expect(shownOptions()).toHaveLength(0);
    expect(document.activeElement).toBe(select);
    expect(closeWindow).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await pressEscape(select);

    expect(closeWindow).toHaveBeenCalledTimes(1);
    shell.dispose();
  });

  it("a disabled item reports nothing when picked", async () => {
    const onValueChange = vi.fn();
    render(
      <Host onValueChange={onValueChange} items={[FRUITS[0], { ...FRUITS[1], disabled: true }]} />,
    );

    await open(trigger());
    await pick("Banana, the long name");

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("the trigger's tip opens on keyboard focus, and the select still opens", async () => {
    vi.useFakeTimers();
    try {
      render(
        <TooltipHost>
          <Host onValueChange={() => {}} tip="Pick a fruit" />
        </TooltipHost>,
      );
      const select = trigger();

      keyboardFocus(select);
      expect(shownTip()).toBe("Pick a fruit");

      await open(select);
      expect(shownOptions()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
