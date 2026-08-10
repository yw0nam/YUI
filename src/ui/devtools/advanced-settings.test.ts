// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { setLocale } from "../i18n";
import { createAdvancedSettings } from "./advanced-settings";

describe("Advanced Settings", () => {
  let attachedMount: HTMLElement | null = null;

  beforeEach(() => setLocale("en"));
  afterEach(() => {
    attachedMount?.remove();
    attachedMount = null;
    vi.restoreAllMocks();
  });

  it("binds the context-window numeric setting to its existing store", () => {
    const mount = document.createElement("section");
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(mount, { endpoints });

    const window = mount.querySelector<HTMLInputElement>("#devtools-context-window")!;
    window.value = "64000";
    window.dispatchEvent(new Event("input"));
    expect(endpoints.get().chat_model_context_window).toBe("64000");
  });

  it("renders localized heading, labels, sub-lines, and placeholders", () => {
    setLocale("ja");
    const mount = document.createElement("section");
    createAdvancedSettings(mount, { endpoints: createEndpointsSettings() });

    expect(mount.textContent).toContain("上限");
    expect(mount.textContent).toContain("コンテキストウィンドウ（トークン）");
    expect(mount.querySelector<HTMLInputElement>("#devtools-context-window")?.placeholder).toBe(
      "デフォルト",
    );
  });

  it("keeps the context-window text while the input is focused", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(attachedMount, { endpoints });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-context-window")!;

    input.focus();
    input.value = "64000";
    endpoints.set({ chat_model_context_window: "128000" });

    expect(input.value).toBe("64000");
  });

  it("reflects the context-window value when the input blurs", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(attachedMount, { endpoints });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-context-window")!;

    input.focus();
    input.value = "64000";
    endpoints.set({ chat_model_context_window: "128000" });
    input.blur();

    expect(input.value).toBe("128000");
  });

  it("reflects the context-window value while the document is unfocused", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(attachedMount, { endpoints });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-context-window")!;
    input.focus();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    input.value = "64000";
    endpoints.set({ chat_model_context_window: "128000" });

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("128000");
  });
});
