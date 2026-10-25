import { describe, expect, it } from "vitest";
import { conversationSyncStores, createConversationStores } from "./conversation-stores";

describe("createConversationStores", () => {
  it("constructs exactly the seven cross-window conversation stores", () => {
    const stores = createConversationStores();

    expect(Object.keys(stores)).toEqual([
      "contextHistory",
      "sessionStore",
      "sessionDiagnostics",
      "chatHistoryStore",
      "signalHistoryStore",
      "overheardStore",
      "relationsStore",
    ]);
    // Every window iterates the bag for teardown, so each store must be disposable.
    for (const store of Object.values(stores)) {
      expect(typeof store.dispose).toBe("function");
      store.dispose();
    }
  });

  it("broadcasts the relations store's own writes", () => {
    const stores = createConversationStores();

    expect(conversationSyncStores(stores).extraBroadcast).toContain(stores.relationsStore);
    for (const store of Object.values(stores)) store.dispose();
  });
});
