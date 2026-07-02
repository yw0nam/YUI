/**
 * agent-notify-settings.test.ts — createAgentNotifySettings reactive store.
 *
 * Checks:
 *  - defaults: { enabled: false, port: 8770 }
 *  - setEnabled: persists and notifies; same value is a no-op
 *  - setPort: persists and notifies; invalid values are no-ops
 *  - round-trip via a fresh store on the same in-memory storage
 *  - hydration priority: stored > initial > defaults
 *  - malformed/throwing storage → defaults
 *  - reloadFromStorage: cross-window sync, identical value and absent storage are no-ops
 *  - subscribe/unsubscribe, dispose
 */

import { describe, expect, it, vi } from "vitest";
import {
  type AgentNotifySettings,
  type AgentNotifyStorage,
  createAgentNotifySettings,
} from "./agent-notify-settings";

function fakeStorage(
  initial?: AgentNotifySettings | null,
  opts?: { throwOnLoad?: boolean },
): AgentNotifyStorage & { saved: AgentNotifySettings[] } {
  const saved: AgentNotifySettings[] = [];
  return {
    saved,
    load() {
      if (opts?.throwOnLoad) throw new Error("storage exploded");
      return initial ?? null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

function memStorage(): AgentNotifyStorage & { _data: AgentNotifySettings | null } {
  let data: AgentNotifySettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: AgentNotifySettings | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = { ...s };
    },
  };
}

describe("createAgentNotifySettings — defaults", () => {
  it("defaults to { enabled: false, port: 8770 } when no options given", () => {
    const store = createAgentNotifySettings();
    expect(store.get()).toEqual({ enabled: false, port: 8770 });
  });

  it("default port is 8770", () => {
    const store = createAgentNotifySettings();
    expect(store.get().port).toBe(8770);
  });

  it("does not throw when no options given", () => {
    expect(() => createAgentNotifySettings()).not.toThrow();
  });
});

describe("createAgentNotifySettings — setEnabled", () => {
  it("setEnabled(true) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createAgentNotifySettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true);

    expect(store.get().enabled).toBe(true);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].enabled).toBe(true);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].enabled).toBe(true);
  });

  it("setEnabled with same value is a no-op (no persist, no notify)", () => {
    const storage = fakeStorage(null);
    const store = createAgentNotifySettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false); // same as default
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createAgentNotifySettings — setPort", () => {
  it("setPort(9000) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createAgentNotifySettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPort(9000);

    expect(store.get().port).toBe(9000);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].port).toBe(9000);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].port).toBe(9000);
  });

  it("setPort(9000) round-trips via a fresh store on the same storage", () => {
    const storage = memStorage();
    const store1 = createAgentNotifySettings({ storage });
    store1.setPort(9000);

    const store2 = createAgentNotifySettings({ storage });
    expect(store2.get().port).toBe(9000);
  });

  it("setPort with same value is a no-op (no persist, no notify)", () => {
    const storage = fakeStorage(null);
    const store = createAgentNotifySettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setPort(8770); // same as default
    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setPort rejects 1023 (below 1024 floor)", () => {
    const store = createAgentNotifySettings();
    store.setPort(1023);
    expect(store.get().port).toBe(8770);
  });

  it("setPort rejects 70000 (above 65535 ceiling)", () => {
    const store = createAgentNotifySettings();
    store.setPort(70000);
    expect(store.get().port).toBe(8770);
  });

  it("setPort rejects 8770.5 (non-integer)", () => {
    const store = createAgentNotifySettings();
    store.setPort(8770.5);
    expect(store.get().port).toBe(8770);
  });

  it("setPort rejects NaN", () => {
    const store = createAgentNotifySettings();
    store.setPort(NaN);
    expect(store.get().port).toBe(8770);
  });
});

describe("createAgentNotifySettings — round-trip persistence", () => {
  it("setEnabled(true) persists and round-trips via a fresh store on the same storage", () => {
    const storage = memStorage();
    const store1 = createAgentNotifySettings({ storage });
    store1.setEnabled(true);

    const store2 = createAgentNotifySettings({ storage });
    expect(store2.get().enabled).toBe(true);
  });
});

describe("createAgentNotifySettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: AgentNotifySettings = { enabled: true, port: 9001 };
    const initial: AgentNotifySettings = { enabled: false, port: 8770 };
    const store = createAgentNotifySettings({ storage: fakeStorage(stored), initial });
    expect(store.get()).toEqual(stored);
  });

  it("initial wins over defaults when no stored value", () => {
    const initial: AgentNotifySettings = { enabled: true, port: 9002 };
    const store = createAgentNotifySettings({ storage: fakeStorage(null), initial });
    expect(store.get()).toEqual(initial);
  });
});

describe("createAgentNotifySettings — malformed/throwing storage", () => {
  it("storage.load() throws → defaults, factory does not throw", () => {
    const store = createAgentNotifySettings({ storage: fakeStorage(null, { throwOnLoad: true }) });
    expect(store.get()).toEqual({ enabled: false, port: 8770 });
  });

  it("enabled is not a boolean → defaults", () => {
    const malformed = { enabled: "yes", port: 8770 } as unknown as AgentNotifySettings;
    const store = createAgentNotifySettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ enabled: false, port: 8770 });
  });

  it("stored blob with missing port → defaults", () => {
    const malformed = { enabled: true } as unknown as AgentNotifySettings;
    const store = createAgentNotifySettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ enabled: false, port: 8770 });
  });

  it("stored blob with invalid port (1023) → defaults", () => {
    const malformed = { enabled: true, port: 1023 } as unknown as AgentNotifySettings;
    const store = createAgentNotifySettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ enabled: false, port: 8770 });
  });

  it("stored blob with non-integer port → defaults", () => {
    const malformed = { enabled: true, port: 8770.5 } as unknown as AgentNotifySettings;
    const store = createAgentNotifySettings({ storage: fakeStorage(malformed) });
    expect(store.get()).toEqual({ enabled: false, port: 8770 });
  });
});

describe("createAgentNotifySettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed value and notifies", () => {
    const storage = memStorage();
    const store = createAgentNotifySettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { enabled: true, port: 8770 };
    store.reloadFromStorage();

    expect(store.get()).toEqual({ enabled: true, port: 8770 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createAgentNotifySettings({ storage });
    store.setEnabled(true); // persists { enabled: true, port: 8770 }
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage(); // same value → no notify
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createAgentNotifySettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createAgentNotifySettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe fn that stops notifications", () => {
    const store = createAgentNotifySettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setEnabled(true);
    expect(cb).toHaveBeenCalledOnce();

    unsub();
    store.setEnabled(false);
    expect(cb).toHaveBeenCalledOnce(); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createAgentNotifySettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setEnabled(true);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

describe("createAgentNotifySettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createAgentNotifySettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setEnabled(true);
    expect(cb).not.toHaveBeenCalled();
  });
});
