// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMentionPicker } from "./mention-picker";

const CAST = [
  { id: "perlica", name: "Perlica" },
  { id: "natsume", name: "Natsume" },
];

let field: HTMLTextAreaElement;
let onPick: ReturnType<typeof vi.fn<(mention: string) => void>>;
/** Stands in for the text input's own Enter and Escape handler, registered after the picker's. */
let reachesInput: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>;

function type(text: string): void {
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(key: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  field.dispatchEvent(e);
  return e;
}

function list(): HTMLElement {
  return document.querySelector<HTMLElement>("[role=listbox]")!;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="dock"><textarea></textarea></div>';
  field = document.querySelector("textarea")!;
  onPick = vi.fn<(mention: string) => void>();
  createMentionPicker({
    field,
    mount: document.querySelector("#dock")!,
    cast: () => CAST,
    onPick,
  });
  reachesInput = vi.fn<(e: KeyboardEvent) => void>();
  field.addEventListener("keydown", reachesInput);
});

describe("createMentionPicker", () => {
  it("opens on an @ and lists the matching characters then @everyone", () => {
    type("hi @na");

    expect(list().hidden).toBe(false);
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect([...list().querySelectorAll(".yui-uc__opt-name")].map((o) => o.textContent)).toEqual([
      "Natsume",
      "@everyone",
    ]);
  });

  it("stays closed for an @ inside a word", () => {
    type("mail@na");

    expect(list().hidden).toBe(true);
  });

  it("Enter on an active option picks it, removes the fragment and does not reach the input", () => {
    type("hi @na");

    press("Enter");

    expect(onPick).toHaveBeenCalledExactlyOnceWith("natsume");
    expect(field.value).toBe("hi ");
    expect(list().hidden).toBe(true);
    expect(reachesInput).not.toHaveBeenCalled();
  });

  it("picks @everyone with the arrow keys", () => {
    type("@");

    press("ArrowDown");
    press("ArrowDown");
    press("Enter");

    expect(onPick).toHaveBeenCalledExactlyOnceWith("everyone");
  });

  it("Enter with the list closed, or open on no active option, reaches the input", () => {
    type("hello");
    press("Enter");
    type("@zz");
    press("Enter");

    expect(onPick).not.toHaveBeenCalled();
    expect(reachesInput).toHaveBeenCalledTimes(2);
  });

  it("Escape closes an open list without reaching the input, and reaches it when closed", () => {
    type("@na");

    press("Escape");
    expect(list().hidden).toBe(true);
    expect(reachesInput).not.toHaveBeenCalled();

    press("Escape");
    expect(reachesInput).toHaveBeenCalledOnce();
  });

  it("ignores Enter while an IME commits", () => {
    type("@na");

    const e = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true });
    field.dispatchEvent(e);

    expect(onPick).not.toHaveBeenCalled();
  });
});
