// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { setLocale, t } from "../../../i18n";
import { createPanelShell } from "../../panel-shell";
import { ModelField } from "./model-field";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Holds the field's text like Detailed settings' drafts do. */
function Host({
  ids,
  onCommit = () => {},
  onBlur = () => {},
}: {
  ids: readonly string[];
  onCommit?: (value: string) => void;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="yui-input-row">
      <label id="yui-chat-model-list-label" htmlFor="yui-ep-chat_model">
        Chat model
      </label>
      <ModelField
        value={value}
        ids={ids}
        disabled={false}
        labelId="yui-chat-model-list-label"
        onType={setValue}
        onCommit={(next) => {
          onCommit(next);
          setValue(next);
        }}
        onBlur={onBlur}
      />
    </div>
  );
}

function type(input: HTMLElement, value: string) {
  act(() => {
    fireEvent.input(input, { target: { value }, inputType: "insertText" });
  });
}

async function key(target: Element, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(target, { key: k, ...init });
  });
}

/** The items of the open popup; a closed popup may stay mounted under a hidden positioner. */
const options = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(
    (o) => !o.closest("[hidden]"),
  );
const listbox = () =>
  [...document.querySelectorAll<HTMLElement>('[role="listbox"]')].find(
    (l) => !l.closest("[hidden]"),
  ) ?? null;

describe("ModelField — the empty and Escape cases", () => {
  let closeWindow: Mock<() => void>;
  let shell: ReturnType<typeof createPanelShell>;

  beforeEach(() => {
    setLocale("en");
    closeWindow = vi.fn<() => void>();
    // The panel's document handler first, as the settings window registers it.
    shell = createPanelShell({
      root: document.body,
      closeWindow,
      onOpen: () => {},
      onClose: () => {},
    });
    shell.open();
  });

  afterEach(() => {
    shell.dispose();
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("with no ids from the server no popup opens, and Escape closes the window keeping the text", async () => {
    render(<Host ids={[]} />);
    const input = screen.queryByRole("combobox");
    expect(input).not.toBeNull();

    act(() => input!.focus());
    type(input!, "my-model");
    await key(input!, "ArrowDown");

    expect(listbox()).toBeNull();
    await key(input!, "Escape");
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe("my-model");
  });

  it("with ids but no match the popup shows the no-match line; Escape closes it only, the next reaches the window, and the text stays", async () => {
    render(<Host ids={["m1", "m2"]} />);
    const input = screen.queryByRole("combobox");
    expect(input).not.toBeNull();

    act(() => input!.focus());
    type(input!, "zzz");

    expect(options()).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain(t("svc.chat_models_no_match"));

    await key(input!, "Escape");
    expect(screen.queryByRole("status")).toBeNull();
    expect(closeWindow).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("zzz");

    await key(input!, "Escape");
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe("zzz");
  });

  it("an Escape on the open list closes it only; one on the shut list leaves the typed text and closes the window", async () => {
    render(<Host ids={["m1", "m2"]} />);
    const input = screen.queryByRole("combobox");
    expect(input).not.toBeNull();

    act(() => input!.focus());
    type(input!, "m");
    expect(options().map((o) => o.textContent)).toEqual(["m1", "m2"]);

    await key(input!, "Escape");
    expect(options()).toEqual([]);
    expect(closeWindow).not.toHaveBeenCalled();

    await key(input!, "Escape");
    expect((input as HTMLInputElement).value).toBe("m");
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});

describe("ModelField", () => {
  beforeEach(() => setLocale("en"));

  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  const optionTexts = () => options().map((o) => o.textContent);
  const highlightedText = (input: HTMLElement) => {
    const id = input.getAttribute("aria-activedescendant");
    return id ? document.getElementById(id)?.textContent : undefined;
  };

  it("filters the ids by case-insensitive substring while typing", () => {
    render(<Host ids={["m1", "m2", "s1"]} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());

    type(input, "M");
    expect(optionTexts()).toEqual(["m1", "m2"]);

    type(input, "m2");
    expect(optionTexts()).toEqual(["m2"]);
  });

  it("arrows move the highlight and Enter picks it, focus staying on the field", async () => {
    const onCommit = vi.fn();
    render(<Host ids={["m1", "m2"]} onCommit={onCommit} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());

    // The first arrow opens the shut list without a highlight.
    await key(input, "ArrowDown");
    await key(input, "ArrowDown");
    expect(highlightedText(input)).toBe("m1");
    await key(input, "ArrowDown");
    await key(input, "ArrowUp");
    expect(highlightedText(input)).toBe("m1");

    await key(input, "Enter");
    expect(onCommit.mock.calls).toEqual([["m1"]]);
    expect(options()).toEqual([]);
    expect(document.activeElement).toBe(input);
  });

  it("a pointer pick commits the id with focus staying on the field", async () => {
    const onCommit = vi.fn();
    render(<Host ids={["m1", "m2"]} onCommit={onCommit} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    type(input, "m");

    const second = options()[1]!;
    await act(async () => {
      fireEvent.pointerDown(second);
      fireEvent.click(second);
    });

    expect(onCommit.mock.calls).toEqual([["m2"]]);
    expect(document.activeElement).toBe(input);
  });

  it("typed text commits on Enter with no id highlighted, and on blur through the drafts", async () => {
    const onCommit = vi.fn();
    const onBlur = vi.fn();
    render(<Host ids={["m1"]} onCommit={onCommit} onBlur={onBlur} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    type(input, "my-model");

    await key(input, "Enter");
    expect(onCommit.mock.calls).toEqual([["my-model"]]);

    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it.each<[string, KeyboardEventInit]>([
    ["isComposing", { isComposing: true }],
    ["keyCode 229", { keyCode: 229 }],
  ])("an IME's Enter (%s) commits no typed text", async (_, init) => {
    const onCommit = vi.fn();
    render(<Host ids={["m1"]} onCommit={onCommit} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    type(input, "zz");

    await key(input, "Enter", init);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("an IME's Enter (keyCode 229) on a highlighted id picks nothing", async () => {
    const onCommit = vi.fn();
    render(<Host ids={["m1"]} onCommit={onCommit} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    await key(input, "ArrowDown");
    await key(input, "ArrowDown");
    expect(highlightedText(input)).toBe("m1");

    await key(input, "Enter", { keyCode: 229 });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape keeps the list shut across re-renders until typing or an arrow reopens it", async () => {
    const { rerender } = render(<Host ids={["qwen3:8b", "qwen3:latest"]} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    type(input, "q");
    expect(options()).toHaveLength(2);

    await key(input, "Escape");
    expect(options()).toEqual([]);

    // A re-render with the same ids does not reopen a dismissed list.
    rerender(<Host ids={["qwen3:8b", "qwen3:latest"]} />);
    expect(options()).toEqual([]);

    type(input, "qwen3");
    expect(options()).toHaveLength(2);

    await key(input, "Escape");
    await key(input, "ArrowDown");
    expect(optionTexts()).toEqual(["qwen3:8b", "qwen3:latest"]);
  });

  it("an Escape while an IME composes leaves the list open and the window open", async () => {
    const closeWindow = vi.fn();
    const shell = createPanelShell({
      root: document.body,
      closeWindow,
      onOpen: () => {},
      onClose: () => {},
    });
    shell.open();
    render(<Host ids={["m1"]} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    type(input, "m");

    fireEvent.compositionStart(input);
    await key(input, "Escape", { isComposing: true });

    expect(optionTexts()).toEqual(["m1"]);
    expect(closeWindow).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    shell.dispose();
  });

  it("gives the listbox the model label's name", () => {
    render(<Host ids={["m1"]} />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    type(input, "m");

    expect(screen.getByRole("listbox", { name: "Chat model" })).not.toBeNull();
  });
});
