// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { createModelCombobox } from "./model-combobox";

function mountRow() {
  const row = document.createElement("div");
  row.className = "yui-input-row";
  const wrap = document.createElement("div");
  wrap.className = "yui-input-wrap";
  const input = document.createElement("input");
  input.id = "yui-ep-chat_model";
  wrap.append(input);
  row.append(wrap);
  document.body.append(row);
  return { row, input };
}

function optionTexts(list: HTMLElement): string[] {
  return [...list.querySelectorAll<HTMLLIElement>(".yui-model-list__opt")].map(
    (opt) => opt.textContent ?? "",
  );
}

describe("createModelCombobox", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("filters the ids by case-insensitive substring while typing", () => {
    const { input } = mountRow();
    const picks: string[] = [];
    const combobox = createModelCombobox({ input, onPick: (id) => picks.push(id) });

    combobox.setOptions(["m1", "m2", "s1"]);
    input.focus();
    const list = document.getElementById("yui-chat-model-list")!;
    expect(optionTexts(list)).toEqual(["m1", "m2", "s1"]);

    input.value = "M";
    input.dispatchEvent(new Event("input"));
    expect(optionTexts(list)).toEqual(["m1", "m2"]);

    input.value = "m2";
    input.dispatchEvent(new Event("input"));
    expect(optionTexts(list)).toEqual(["m2"]);

    combobox.dispose();
  });

  it("keeps a typed name outside the list and shows the no-match message beside the listbox", () => {
    const { row, input } = mountRow();
    const combobox = createModelCombobox({ input, onPick: () => {} });

    combobox.setOptions(["m1"]);
    input.focus();
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    const list = document.getElementById("yui-chat-model-list")!;
    const none = row.querySelector<HTMLElement>(".yui-model-list__none")!;

    expect(list.hidden).toBe(true);
    expect(none.hidden).toBe(false);
    expect(none.textContent).toBe(t("svc.chat_models_no_match"));
    expect(input.value).toBe("zzz");

    combobox.dispose();
  });

  it("ArrowDown activates and Enter picks, reporting the id", () => {
    const { input } = mountRow();
    const picks: string[] = [];
    const combobox = createModelCombobox({ input, onPick: (id) => picks.push(id) });

    combobox.setOptions(["m1", "m2"]);
    input.focus();
    const list = document.getElementById("yui-chat-model-list")!;

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(input.getAttribute("aria-activedescendant")).toBe(`${list.id}-opt-0`);
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toBe("m1");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.getAttribute("aria-activedescendant")).toBe(`${list.id}-opt-0`);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(picks).toEqual(["m1"]);
    expect(list.hidden).toBe(true);

    combobox.dispose();
  });

  it("Escape closes the list and keeps the panel's Escape handler out while it is open", () => {
    const { input } = mountRow();
    const combobox = createModelCombobox({ input, onPick: () => {} });
    let panelClosed = false;
    const panelHandler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") panelClosed = true;
    };
    document.addEventListener("keydown", panelHandler);

    combobox.setOptions(["m1"]);
    input.focus();
    const list = document.getElementById("yui-chat-model-list")!;
    expect(list.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list.hidden).toBe(true);
    expect(panelClosed).toBe(false);

    // With the list closed, Escape belongs to the panel again.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panelClosed).toBe(true);

    document.removeEventListener("keydown", panelHandler);
    combobox.dispose();
  });

  it("selects on mousedown before blur, with focus staying on the input", () => {
    const { input } = mountRow();
    const picks: string[] = [];
    const combobox = createModelCombobox({ input, onPick: (id) => picks.push(id) });

    combobox.setOptions(["m1", "m2"]);
    input.focus();
    const list = document.getElementById("yui-chat-model-list")!;
    const second = list.querySelectorAll<HTMLLIElement>(".yui-model-list__opt")[1]!;

    second.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(picks).toEqual(["m2"]);
    expect(document.activeElement).toBe(input);

    combobox.dispose();
  });

  it("ignores Enter while the IME composition is active", () => {
    const { input } = mountRow();
    const picks: string[] = [];
    const combobox = createModelCombobox({ input, onPick: (id) => picks.push(id) });

    combobox.setOptions(["m1"]);
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
    // WKWebView commits the composition with isComposing false but keyCode 229.
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }),
    );

    expect(picks).toEqual([]);

    combobox.dispose();
  });

  it("gives the listbox the model label's name", () => {
    const { row, input } = mountRow();
    const label = document.createElement("label");
    label.setAttribute("for", "yui-ep-chat_model");
    row.prepend(label);
    const combobox = createModelCombobox({ input, onPick: () => {} });
    const list = document.getElementById("yui-chat-model-list")!;

    expect(list.getAttribute("aria-labelledby")).toBe(label.id);

    combobox.dispose();
  });

  it("ArrowDown reopens a closed, non-empty list", () => {
    const { input } = mountRow();
    const combobox = createModelCombobox({ input, onPick: () => {} });
    combobox.setOptions(["m1"]);
    input.focus();
    const list = document.getElementById("yui-chat-model-list")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list.hidden).toBe(true);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(list.hidden).toBe(false);
    expect(optionTexts(list)).toEqual(["m1"]);

    combobox.dispose();
  });
});
