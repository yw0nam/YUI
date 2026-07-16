// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowSettings,
  type WorkflowSettings,
  type WorkflowStorage,
} from "../../io/workflow-settings";
import type { Logger } from "../../logger";
import { setLocale } from "../i18n";
import { createWorkflowsSection } from "./workflows-section";

const ENTRY = { id: "morning", label: "Morning digest", url: "https://example.com/hook" };

function memoryStorage(initial?: WorkflowSettings): WorkflowStorage {
  let value = initial ?? null;
  return {
    load: () => value,
    save: (settings) => {
      value = structuredClone(settings);
    },
  };
}

function buildRoot(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="yui-wf-list"></div>
    <div class="yui-wf-add">
      <div class="yui-input-row" data-wf-field="label">
        <input class="yui-wf-label-input" type="text" />
      </div>
      <div class="yui-input-row" data-wf-field="url">
        <input class="yui-wf-url-input" type="text" />
        <p class="yui-input-row__error">Invalid URL</p>
      </div>
      <button class="yui-wf-add-btn" type="button" disabled>Add</button>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("createWorkflowsSection", () => {
  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false }) as MediaQueryList),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders an empty state or one row per entry with fire and delete actions", () => {
    const emptyRoot = buildRoot();
    const emptySection = createWorkflowsSection({
      root: emptyRoot,
      store: createWorkflowSettings(),
      log: makeLog(),
      fetchFn: vi.fn(),
    });
    expect(emptyRoot.querySelector(".yui-wf-empty")?.textContent).toContain("No workflows yet");
    emptySection.dispose();

    const root = buildRoot();
    const store = createWorkflowSettings({
      initial: {
        entries: [
          ENTRY,
          { id: "deploy", label: "Deploy notify", url: "https://example.com/deploy" },
        ],
      },
    });
    const section = createWorkflowsSection({ root, store, log: makeLog(), fetchFn: vi.fn() });

    expect(root.querySelectorAll(".yui-wf")).toHaveLength(2);
    expect(root.querySelector(".yui-wf__name")?.textContent).toBe("Morning digest");
    expect(root.querySelector(".yui-wf__fire")?.getAttribute("aria-label")).toBe(
      "Fire Morning digest",
    );
    expect(root.querySelector(".yui-wf__delete")?.getAttribute("aria-label")).toBe(
      "Delete Morning digest",
    );
    section.dispose();
  });

  it("validates the add form, persists a workflow, and clears the fields", () => {
    const root = buildRoot();
    const store = createWorkflowSettings({ storage: memoryStorage() });
    const section = createWorkflowsSection({ root, store, log: makeLog(), fetchFn: vi.fn() });
    const label = root.querySelector<HTMLInputElement>(".yui-wf-label-input")!;
    const url = root.querySelector<HTMLInputElement>(".yui-wf-url-input")!;
    const urlRow = root.querySelector<HTMLElement>('[data-wf-field="url"]')!;
    const add = root.querySelector<HTMLButtonElement>(".yui-wf-add-btn")!;

    label.value = "Morning digest";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    expect(add.disabled).toBe(true);

    url.value = "not-a-url";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    expect(add.disabled).toBe(true);
    expect(urlRow.classList.contains("is-invalid")).toBe(true);

    url.value = "https://example.com/hook";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    expect(add.disabled).toBe(false);
    expect(urlRow.classList.contains("is-invalid")).toBe(false);

    add.click();
    expect(store.get().entries).toHaveLength(1);
    expect(store.get().entries[0]).toMatchObject({
      label: "Morning digest",
      url: "https://example.com/hook",
    });
    expect(label.value).toBe("");
    expect(url.value).toBe("");
    expect(add.disabled).toBe(true);
    section.dispose();
  });

  it("posts without reading the response body and shows success feedback", async () => {
    const root = buildRoot();
    const response = { json: vi.fn(), text: vi.fn() };
    const fetchFn = vi.fn().mockResolvedValue(response);
    const section = createWorkflowsSection({
      root,
      store: createWorkflowSettings({ initial: { entries: [ENTRY] } }),
      log: makeLog(),
      fetchFn,
    });

    root.querySelector<HTMLButtonElement>(".yui-wf__fire")!.click();

    await vi.waitFor(() =>
      expect(root.querySelector(".yui-wf")?.classList.contains("yui-wf--fired-ok")).toBe(true),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      ENTRY.url,
      expect.objectContaining({ method: "POST", mode: "no-cors", body: "{}" }),
    );
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(response.json).not.toHaveBeenCalled();
    expect(response.text).not.toHaveBeenCalled();
    section.dispose();
  });

  it("logs a rejected post and shows error feedback", async () => {
    const root = buildRoot();
    const error = new Error("offline");
    const fetchFn = vi.fn().mockRejectedValue(error);
    const log = makeLog();
    const section = createWorkflowsSection({
      root,
      store: createWorkflowSettings({ initial: { entries: [ENTRY] } }),
      log,
      fetchFn,
    });

    root.querySelector<HTMLButtonElement>(".yui-wf__fire")!.click();

    await vi.waitFor(() =>
      expect(root.querySelector(".yui-wf")?.classList.contains("yui-wf--fired-err")).toBe(true),
    );
    expect(log.debug).toHaveBeenCalledWith("workflow_fire_failed", {
      id: ENTRY.id,
      error: String(error),
    });
    section.dispose();
  });

  it("deletes the selected workflow", () => {
    const root = buildRoot();
    const store = createWorkflowSettings({ initial: { entries: [ENTRY] } });
    const section = createWorkflowsSection({ root, store, log: makeLog(), fetchFn: vi.fn() });

    root.querySelector<HTMLButtonElement>(".yui-wf__delete")!.click();

    expect(store.get().entries).toEqual([]);
    expect(root.querySelector(".yui-wf-empty")).not.toBeNull();
    section.dispose();
  });

  it("stops rendering store changes after dispose", () => {
    const root = buildRoot();
    const store = createWorkflowSettings();
    const section = createWorkflowsSection({ root, store, log: makeLog(), fetchFn: vi.fn() });
    section.dispose();

    store.addWorkflow({ label: "Late", url: "https://example.com/late" });

    expect(root.querySelector(".yui-wf")).toBeNull();
    expect(root.querySelector(".yui-wf-empty")).not.toBeNull();
  });
});
