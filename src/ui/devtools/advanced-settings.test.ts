// @vitest-environment jsdom

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/chat/conversation/context-history";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { setLocale } from "../i18n";
import { createAdvancedSettings } from "./advanced-settings";
import { createDevtoolsShell } from "./shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Advanced Settings", () => {
  let attachedMount: HTMLElement | null = null;
  let shell: ReturnType<typeof createDevtoolsShell> | null = null;

  beforeEach(() => setLocale("en"));
  afterEach(() => {
    act(() => shell?.dispose());
    shell = null;
    document.body.innerHTML = "";
    attachedMount?.remove();
    attachedMount = null;
    vi.restoreAllMocks();
  });

  it("writes the context window once on blur, not on each keystroke, and an emptied field as empty", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const endpoints = createEndpointsSettings();
    const writes: string[] = [];
    endpoints.subscribe(() => writes.push(endpoints.get().chat_model_context_window));
    shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      endpointsSettings: endpoints,
      loadMotionPreview: vi.fn(async () => ({ dispose: vi.fn() })),
    });
    await act(() => shell.activate("advanced"));
    const input = screen.queryByLabelText<HTMLInputElement>("Context window (tokens)");
    expect(input).not.toBeNull();
    if (!input) return;

    act(() => input.focus());
    fireEvent.input(input, { target: { value: "6" } });
    fireEvent.input(input, { target: { value: "64000" } });
    expect(writes).toEqual([]);

    act(() => input.blur());
    expect(writes).toEqual(["64000"]);

    act(() => input.focus());
    fireEvent.input(input, { target: { value: "" } });
    act(() => input.blur());
    expect(writes).toEqual(["64000", ""]);
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
