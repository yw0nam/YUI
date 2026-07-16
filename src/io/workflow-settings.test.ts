import { describe, expect, it, vi } from "vitest";
import {
  createWorkflowSettings,
  type WorkflowSettings,
  type WorkflowStorage,
} from "./workflow-settings";

function fakeStorage(initial?: WorkflowSettings | null): WorkflowStorage & {
  saved: WorkflowSettings[];
  value: WorkflowSettings | null;
} {
  const saved: WorkflowSettings[] = [];
  return {
    saved,
    value: initial ?? null,
    load() {
      return this.value;
    },
    save(settings) {
      saved.push(settings);
      this.value = settings;
    },
  };
}

const ENTRY = { id: "morning", label: "Morning digest", url: "https://example.com/hook" };

describe("createWorkflowSettings", () => {
  it("defaults to an empty entry list", () => {
    expect(createWorkflowSettings().get()).toEqual({ entries: [] });
  });

  it("returns a deep clone from get", () => {
    const store = createWorkflowSettings({ initial: { entries: [ENTRY] } });
    const settings = store.get();
    settings.entries[0].label = "Changed";
    settings.entries.push({ id: "other", label: "Other", url: "https://example.com/other" });

    expect(store.get()).toEqual({ entries: [ENTRY] });
  });

  it("adds a trimmed workflow, persists, notifies, and returns a clone", () => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage });
    const listener = vi.fn();
    store.subscribe(listener);

    const entry = store.addWorkflow({
      label: "  Morning digest  ",
      url: "  https://example.com/hook  ",
    });

    expect(entry).toMatchObject({ label: "Morning digest", url: "https://example.com/hook" });
    expect(entry?.id).toEqual(expect.any(String));
    expect(store.get().entries).toEqual([entry]);
    expect(storage.saved).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    if (entry) entry.label = "Changed";
    expect(store.get().entries[0].label).toBe("Morning digest");
  });

  it.each(["", "   "])("rejects invalid label %j without persisting or notifying", (label) => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.addWorkflow({ label, url: "https://example.com/hook" })).toBeNull();
    expect(storage.saved).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "foo",
    "ftp://x",
  ])("rejects invalid URL %j without persisting or notifying", (url) => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.addWorkflow({ label: "Morning", url })).toBeNull();
    expect(storage.saved).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("updates valid label and URL values, persists, and notifies", () => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage, initial: { entries: [ENTRY] } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.updateWorkflow("morning", {
      label: "  Daily digest  ",
      url: "  http://localhost:5678/webhook  ",
    });

    expect(store.get().entries[0]).toEqual({
      id: "morning",
      label: "Daily digest",
      url: "http://localhost:5678/webhook",
    });
    expect(storage.saved).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores empty labels and invalid URLs", () => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage, initial: { entries: [ENTRY] } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.updateWorkflow("morning", { label: "  ", url: "ftp://example.com" });

    expect(store.get().entries[0]).toEqual(ENTRY);
    expect(storage.saved).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify for unchanged values or an unknown id", () => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage, initial: { entries: [ENTRY] } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.updateWorkflow("morning", { label: ENTRY.label, url: ENTRY.url });
    store.updateWorkflow("missing", { label: "Other" });

    expect(storage.saved).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("removes a workflow, persists, and notifies", () => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage, initial: { entries: [ENTRY] } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.removeWorkflow("morning");

    expect(store.get().entries).toEqual([]);
    expect(storage.saved).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing when removing an unknown id", () => {
    const storage = fakeStorage();
    const store = createWorkflowSettings({ storage, initial: { entries: [ENTRY] } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.removeWorkflow("missing");

    expect(storage.saved).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("hydrates saved settings before initial settings and defaults", () => {
    const saved = { entries: [ENTRY] };
    const initial = {
      entries: [{ id: "initial", label: "Initial", url: "https://example.com/initial" }],
    };

    expect(createWorkflowSettings({ storage: fakeStorage(saved), initial }).get()).toEqual(saved);
    expect(createWorkflowSettings({ storage: fakeStorage(), initial }).get()).toEqual(initial);
    expect(createWorkflowSettings({ storage: fakeStorage() }).get()).toEqual({ entries: [] });
  });

  it.each([
    { entries: [{ id: "bad", label: "Missing URL" }] },
    { entries: [{ id: "bad", label: "Bad URL", url: "ftp://example.com" }] },
  ])("falls back to defaults for malformed saved settings", (malformed) => {
    const store = createWorkflowSettings({
      storage: fakeStorage(malformed as unknown as WorkflowSettings),
    });
    expect(store.get()).toEqual({ entries: [] });
  });

  it("reloads changed saved settings and skips identical or absent values", () => {
    const storage = fakeStorage({ entries: [] });
    const store = createWorkflowSettings({ storage });
    const listener = vi.fn();
    store.subscribe(listener);

    storage.value = { entries: [ENTRY] };
    store.reloadFromStorage();
    store.reloadFromStorage();
    storage.value = null;
    store.reloadFromStorage();

    expect(store.get().entries).toEqual([ENTRY]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports unsubscribe and dispose", () => {
    const store = createWorkflowSettings();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = store.subscribe(first);
    store.subscribe(second);

    unsubscribe();
    store.addWorkflow({ label: "One", url: "https://example.com/one" });
    store.dispose();
    store.addWorkflow({ label: "Two", url: "https://example.com/two" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
