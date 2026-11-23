// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelShell } from "../../quick-controls/panel-shell";
import { Select, type SelectProps } from "./select";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Fruit = "apple" | "banana";
const FRUITS = [
  { value: "apple", label: "Apple, the long name" },
  { value: "banana", label: "Banana, the long name" },
] as const;

/** Holds the value like a store-backed caller does. */
function Host(props: Omit<SelectProps<Fruit>, "value" | "items" | "aria-label">) {
  const [value, setValue] = useState<Fruit>("apple");
  return (
    <Select
      {...props}
      value={value}
      items={FRUITS}
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

async function pick(name: string) {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent === name,
  )!;
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

async function escape(target: Element) {
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

    expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
      "Apple, the long name",
      "Banana, the long name",
    ]);
    await pick("Banana, the long name");
    expect(select.textContent).toBe("Banana");
  });

  it("a disabled select does not open", async () => {
    render(<Host onValueChange={() => {}} disabled />);

    await open(trigger());

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
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
    expect(inside.closest("[data-base-ui-portal]")).not.toBeNull();

    await escape(inside);

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.activeElement).toBe(select);
    expect(closeWindow).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await escape(select);

    expect(closeWindow).toHaveBeenCalledTimes(1);
    shell.dispose();
  });
});
