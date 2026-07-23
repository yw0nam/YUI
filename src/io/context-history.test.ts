import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_HISTORY_CAP,
  type ContextHistoryEntry,
  type ContextHistoryStorage,
  createContextHistory,
} from "./context-history";

function entry(ts: number): ContextHistoryEntry {
  return {
    ts,
    event_name: "user.text",
    trigger_kind: "user",
    included: ["active_app"],
    excluded: [],
    client_context: {
      env: { timestamp: new Date(ts).toISOString(), timezone: "UTC" },
      trigger: { kind: "user" },
    },
  };
}

describe("context history", () => {
  it("keeps only the newest 20 entries", () => {
    const store = createContextHistory();
    for (let index = 0; index < CONTEXT_HISTORY_CAP + 3; index++) store.append(entry(index));

    expect(store.get()).toHaveLength(CONTEXT_HISTORY_CAP);
    expect(store.get()[0]?.ts).toBe(3);
  });

  it("persists appends and reloads cross-window storage", () => {
    let value: ContextHistoryEntry[] | null = null;
    const storage: ContextHistoryStorage = {
      load: () => value,
      save: vi.fn((next) => {
        value = next;
      }),
    };
    const store = createContextHistory({ storage });
    store.append(entry(1));
    expect(storage.save).toHaveBeenCalledOnce();

    value = [entry(2)];
    store.reloadFromStorage();
    expect(store.get()[0]?.ts).toBe(2);
  });
});
