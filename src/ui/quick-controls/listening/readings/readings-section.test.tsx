// @vitest-environment jsdom
/**
 * readings-section.test.tsx — the reading dictionary of the Listening page: what typing commits,
 * when a store change redraws, and the line naming skipped lines.
 */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../../logger";
import { createSttKeySettings } from "../../../../settings/backend/api-key-settings";
import { createReadingsSettings } from "../../../../settings/voice/readings-settings";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { createVoiceInputStatus } from "../../../chips/voice-input-status";
import { setLocale } from "../../../i18n";
import { inMemoryApiKeyStorage } from "../../test-helpers";
import { createListeningPage } from "../listening-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: ReturnType<typeof createListeningPage>[] = [];

function setup(text = "") {
  const store = createReadingsSettings({ storage: { load: () => ({ text }), save: () => {} } });
  const page = createListeningPage({
    showVoiceInput: true,
    voiceStatus: createVoiceInputStatus(),
    vad: createVadSettings({ storage: { load: () => null, save: () => {} } }),
    sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
    readingsSettings: store,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger,
    host: document.body,
  });
  pages.push(page);
  const textarea = page.el.querySelector<HTMLTextAreaElement>("textarea")!;
  const entry = page.el.querySelector<HTMLElement>(".yui-reading__entry")!;
  const message = page.el.querySelector<HTMLElement>(".yui-reading__skipped")!;
  const type = (value: string) => {
    fireEvent.input(textarea, { target: { value } });
  };
  return { page, store, textarea, entry, message, type };
}

describe("ReadingsSection", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    act(() => {
      for (const page of pages.splice(0)) page.dispose();
    });
    document.body.innerHTML = "";
  });

  it("commits what is typed to the store", () => {
    const { store, type } = setup();
    type("秧秧=ヤンヤン");
    expect(store.get()).toEqual({ text: "秧秧=ヤンヤン" });
  });

  it("redraws a store change when the textarea is not focused", () => {
    const { store, textarea } = setup();
    act(() => store.setText("穂穂=スイスイ"));
    expect(textarea.value).toBe("穂穂=スイスイ");
  });

  it("leaves the textarea alone on a store change while it is focused", () => {
    const { store, textarea } = setup();
    textarea.focus();
    textarea.value = "typing";
    act(() => store.setText("穂穂=スイスイ"));
    expect(textarea.value).toBe("typing");
  });

  it("shows the stored text and flags its skipped line, until it is fixed", () => {
    const { textarea, entry, message, type } = setup("a=b\nnoequals");
    expect(textarea.value).toBe("a=b\nnoequals");
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
});
