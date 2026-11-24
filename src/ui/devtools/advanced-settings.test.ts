// @vitest-environment jsdom

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/chat/conversation/context-history";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { setLocale } from "../i18n";
import { createDevtoolsShell } from "./shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Advanced Settings", () => {
  let shell: ReturnType<typeof createDevtoolsShell> | null = null;

  /** The Advanced panel shown, and its context-window input, asserted before a case types in it. */
  async function contextWindow(
    endpoints = createEndpointsSettings(),
    label = "Context window (tokens)",
  ) {
    document.body.innerHTML = '<div id="app"></div>';
    const created = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      endpointsSettings: endpoints,
      loadMotionPreview: vi.fn(async () => ({ dispose: vi.fn() })),
    });
    shell = created;
    await act(() => created.activate("advanced"));
    const input = screen.queryByLabelText<HTMLInputElement>(label);
    expect(input).not.toBeNull();
    return input!;
  }

  beforeEach(() => setLocale("en"));
  afterEach(() => {
    act(() => shell?.dispose());
    shell = null;
    document.body.innerHTML = "";
  });

  it("writes the context window once on blur, not on each keystroke, and an emptied field as empty", async () => {
    const endpoints = createEndpointsSettings();
    const writes: string[] = [];
    endpoints.subscribe(() => writes.push(endpoints.get().chat_model_context_window));
    const input = await contextWindow(endpoints);

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

  it("renders localized heading, labels, sub-lines, and placeholders", async () => {
    setLocale("ja");
    const input = await contextWindow(
      createEndpointsSettings(),
      "コンテキストウィンドウ（トークン）",
    );

    expect(document.body.textContent).toContain("上限");
    expect(input.placeholder).toBe("デフォルト");
  });

  it("shows an outside change of the context window while the field holds no draft", async () => {
    const endpoints = createEndpointsSettings();
    const input = await contextWindow(endpoints);

    act(() => endpoints.set({ chat_model_context_window: "128000" }));

    expect(input.value).toBe("128000");
  });

  it("keeps a typed context-window draft over an outside change and commits it on blur", async () => {
    const endpoints = createEndpointsSettings();
    const input = await contextWindow(endpoints);

    act(() => input.focus());
    fireEvent.input(input, { target: { value: "64000" } });
    act(() => endpoints.set({ chat_model_context_window: "128000" }));
    expect(input.value).toBe("64000");

    act(() => input.blur());
    expect(input.value).toBe("64000");
    expect(endpoints.get().chat_model_context_window).toBe("64000");
  });
});
