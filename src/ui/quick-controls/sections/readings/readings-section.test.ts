// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadingsSettings } from "../../../../settings/voice/readings-settings";
import { setLocale } from "../../../i18n";
import { createReadingsSection, readingsSectionHtml } from "./readings-section";

function setup(text = "") {
  const root = document.createElement("div");
  root.innerHTML = readingsSectionHtml();
  document.body.append(root);
  const store = createReadingsSettings({ storage: { load: () => ({ text }), save: () => {} } });
  const section = createReadingsSection({ root, readingsSettings: store });
  const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;
  const entry = root.querySelector<HTMLElement>(".yui-reading__entry")!;
  const message = root.querySelector<HTMLElement>(".yui-reading__skipped")!;
  const type = (value: string) => {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return { section, store, textarea, entry, message, type };
}

describe("createReadingsSection", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("commits what is typed to the store", () => {
    const { store, type } = setup();
    type("秧秧=ヤンヤン");
    expect(store.get()).toEqual({ text: "秧秧=ヤンヤン" });
  });

  it("shows the stored text on creation", () => {
    expect(setup("秧秧=ヤンヤン").textarea.value).toBe("秧秧=ヤンヤン");
  });

  it("redraws a store change when the textarea is not focused", () => {
    const { store, textarea } = setup();
    store.setText("穂穂=スイスイ");
    expect(textarea.value).toBe("穂穂=スイスイ");
  });

  it("leaves the textarea alone on a store change while it is focused", () => {
    const { store, textarea } = setup();
    textarea.focus();
    textarea.value = "typing";
    store.setText("穂穂=スイスイ");
    expect(textarea.value).toBe("typing");
  });

  it("names a skipped line and flags the entry until it is fixed", () => {
    const { entry, message, type } = setup();
    type("a=b\nnoequals");
    expect(entry.classList.contains("is-invalid")).toBe(true);
    expect(message.textContent).toBe("Line 2 is skipped: write it as word=reading");

    type("a=b\nc=d");
    expect(entry.classList.contains("is-invalid")).toBe(false);
    expect(message.textContent).toBe("");
  });

  it("lists several skipped lines", () => {
    const { message, type } = setup();
    type("x\na=b\n=y");
    expect(message.textContent).toBe("Lines 1, 3 are skipped: write each as word=reading");
  });

  it("flags skipped lines already in the stored text", () => {
    expect(setup("x=").entry.classList.contains("is-invalid")).toBe(true);
  });
});
